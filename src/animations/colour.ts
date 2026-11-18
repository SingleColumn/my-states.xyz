export interface HsvColour { hue: number; saturation: number; value: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function hexToHsv(hex: string): HsvColour {
  const red = parseInt(hex.slice(1, 3), 16) / 255
  const green = parseInt(hex.slice(3, 5), 16) / 255
  const blue = parseInt(hex.slice(5, 7), 16) / 255
  const largest = Math.max(red, green, blue)
  const smallest = Math.min(red, green, blue)
  const difference = largest - smallest
  let hue = 0
  if (difference > 0) {
    if (largest === red) hue = ((green - blue) / difference) % 6
    else if (largest === green) hue = (blue - red) / difference + 2
    else hue = (red - green) / difference + 4
    hue = (hue * 60 + 360) % 360
  }
  return { hue, saturation: largest === 0 ? 0 : difference / largest, value: largest }
}

export function hsvToHex({ hue, saturation, value }: HsvColour): string {
  const sector = ((hue % 360) + 360) % 360 / 60
  const chroma = clamp(value, 0, 1) * clamp(saturation, 0, 1)
  const second = chroma * (1 - Math.abs(sector % 2 - 1))
  const offset = clamp(value, 0, 1) - chroma
  const [red, green, blue] = sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
      : sector < 3 ? [0, chroma, second]
        : sector < 4 ? [0, second, chroma]
          : sector < 5 ? [second, 0, chroma]
            : [chroma, 0, second]
  return `#${[red, green, blue].map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`
}
