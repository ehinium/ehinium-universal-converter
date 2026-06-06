# Performance Strategy

## Goals

* Support very large pages
* Avoid rescanning unchanged nodes
* Minimize DOM mutations
* Minimize API requests

## Current State

* Full document scan
* MutationObserver
* 30 minute exchange rate cache

## Next Optimization

Track processed text nodes.

Use:

WeakSet<Text>

Rules:

* Process a text node once
* Skip already processed nodes
* Newly inserted nodes are eligible
* Removed nodes are automatically garbage collected

## Future Optimizations

* Viewport-only scanning
* RequestIdleCallback
* Incremental mutation processing
* Domain-specific adapters
* Worker-based parsing
