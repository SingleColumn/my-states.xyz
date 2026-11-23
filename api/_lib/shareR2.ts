import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ShareConfig } from './shareConfig.js'

export interface R2Object { bytes: Uint8Array; etag: string }
export interface R2Head { size: number; etag: string }

export function isMissing(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  return status === 404 || (error as { name?: string })?.name === 'NoSuchKey'
}
export function isConflict(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  return status === 409 || status === 412
}

export class ShareR2 {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: ShareConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
  }

  async read(key: string, limit: number): Promise<R2Object | null> {
    let response
    try { response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })) }
    catch (error) { if (isMissing(error)) return null; throw error }
    if (!response.Body || !response.ETag) throw new Error('R2 returned an incomplete object.')
    if (response.ContentLength !== undefined && response.ContentLength > limit) throw new Error('R2 object exceeds the permitted size.')
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength
      if (size > limit) throw new Error('R2 object exceeds the permitted size.')
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return { bytes, etag: response.ETag }
  }

  async head(key: string): Promise<R2Head | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      if (response.ContentLength === undefined || !response.ETag) throw new Error('R2 returned incomplete object metadata.')
      return { size: response.ContentLength, etag: response.ETag }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async putJson(key: string, value: unknown, condition: { none?: true; etag?: string }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json',
      ...(condition.none ? { IfNoneMatch: '*' } : {}),
      ...(condition.etag ? { IfMatch: condition.etag } : {}),
    }))
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async copyCreateOnly(source: string, destination: string, sourceEtag: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destination,
      CopySource: `${this.bucket}/${source}`,
      CopySourceIfMatch: sourceEtag,
      ContentType: 'application/zip',
      CacheControl: 'no-store',
      MetadataDirective: 'REPLACE',
    })
    // R2's destination condition is distinct from S3's copy-source condition.
    // Add it at build time, before the SDK signs the request.
    command.middlewareStack.add((next) => async (args) => {
      const request = args.request as { headers?: Record<string, string> }
      if (!request.headers) throw new Error('R2 copy request has no headers.')
      request.headers['cf-copy-destination-if-none-match'] = '*'
      return next(args)
    }, { step: 'build', name: 'r2DestinationCreateOnly' })
    await this.client.send(command)
  }

  async signedPut(key: string): Promise<{ url: string; headers: Record<string, string> }> {
    const headers = { 'Content-Type': 'application/zip', 'If-None-Match': '*' }
    const url = await getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: headers['Content-Type'], IfNoneMatch: headers['If-None-Match'],
    }), { expiresIn: 900, signableHeaders: new Set(['content-type', 'if-none-match']) })
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? []
    if (!['content-type', 'if-none-match'].every((name) => signed.includes(name))) {
      throw new Error('R2 upload signing omitted a required header.')
    }
    return { url, headers }
  }

  async signedGet(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 120 })
  }

  async list(prefix: string, cursor?: string, limit = 100): Promise<{ keys: string[]; cursor?: string }> {
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: prefix, MaxKeys: Math.min(100, Math.max(1, limit)),
      ContinuationToken: cursor,
    }))
    return {
      keys: (response.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []),
      ...(response.NextContinuationToken ? { cursor: response.NextContinuationToken } : {}),
    }
  }
}
