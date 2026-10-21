# Word Graph generation constraints

Generated graphs enforce their limits while relationships are admitted, then
validate the completed graph before it reaches the UI or recovery storage.

- `maxTotalNodes` counts distinct normalized words, including the root.
- `depth` is the greatest permitted shortest-path distance from the root. Depth
  and connectivity use the undirected topology shown by the visualization;
  relationship direction still controls expansion in the UI.
- `maxConnectionsPerNode` limits accepted outgoing association relationships
  for each source. Incoming relationships do not consume that source's budget.
- Every node must be connected to the root, and every edge endpoint must exist.

Association requests for one breadth level may complete concurrently. Their
candidates are admitted in stable frontier order against one shared node and
edge budget. A new node and its connecting relationship are committed together,
so a rejected relationship cannot leave an orphan node.
