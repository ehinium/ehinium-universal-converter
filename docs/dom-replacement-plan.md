# DOM Replacement Strategy

## Goals

Display converted values without breaking websites.

Example:

$99.99

becomes

$99.99 (€86.03)

## Rules

* Never replace original price
* Never mutate input fields
* Never modify scripts/styles
* Never modify attributes
* Only operate on text nodes
* Only modify nodes containing detected currency values
* Must be reversible
* Must survive React/Vue re-renders

## Rendering Strategy

Phase 1:

* Append converted value inline

Example:
$99.99 → $99.99 (€86.03)

Phase 2:

* Configurable styling

Phase 3:

* Hover-only mode

## Performance

* Scan only visible document
* Use MutationObserver for dynamic pages
* Avoid rescanning already processed nodes
* Cache exchange rates

## Future

* Unit conversion
* Crypto conversion
* Precious metals
* Custom formulas
