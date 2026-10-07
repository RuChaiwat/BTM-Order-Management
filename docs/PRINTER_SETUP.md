# Printer setup for picking/pick-sheet/consolidation print pages

Every print page in this app (`app/pick-sheet/print`, `app/pick-report/print`,
`PrintButton.tsx`, `AutoPrint.tsx`, etc.) triggers printing with the browser's own
`window.print()`. That is a standard web API that only *opens the browser's print dialog* (or, in
kiosk mode, silently submits to whatever printer Chrome currently has as its own default) — **the
web app has no way to choose or force a specific destination printer**. That's an intentional
browser security restriction (a webpage must never be able to silently pick an arbitrary printer),
not a bug in this codebase. The symptoms below are both caused by this, and are fixed on the
workstation/Chrome side, not in the app.

## Symptom: print dialog defaults to "Save as PDF" instead of the machine's printer

Chrome's print dialog remembers the **last destination used in that Chrome profile** — not the
Windows default printer. If "Save as PDF" was ever selected on a machine (very likely during
testing, before a physical printer was connected), Chrome keeps defaulting to it until someone
manually picks the real printer again.

**Fix — force Chrome to always default to a specific printer**, via the Chrome Enterprise policy
`DefaultPrinterSelection`. On Windows, set this registry value (per machine, naming that machine's
own printer):

```
Path:  HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome
Name:  DefaultPrinterSelection
Type:  REG_SZ
Value: {"kind":"local","idPattern":"<exact Windows printer name>","namePattern":".*"}
```

Restart Chrome after setting it. This overrides the "last used destination" memory and makes
Chrome always pre-select that printer in the print dialog. (On Linux/macOS Chrome, the same key
goes in a managed `policies.json` / macOS configuration profile instead of the registry.)

## Symptom: machines using a `--kiosk-printing` shortcut print incorrectly

`--kiosk-printing` skips the print dialog entirely and silently prints to **whatever printer Chrome
currently has as its own default**, using the **print settings (paper size / margins / scale) that
were last used on that machine**. Two independent things can go wrong:

1. Chrome's own default printer isn't the physical slip/label printer (e.g. it's still
   "Microsoft Print to PDF", or a different printer than intended).
2. The last-used paper size/margin/scale doesn't match the document's actual `@page` size (this
   app prints 80mm thermal slips at `@page { size: 80mm auto; margin: 0 }` — see
   `src/components/assignment/PickSlipDocument.tsx` — and A5/A4 for pick sheets/reports), so kiosk
   mode silently applies the wrong settings with no dialog to catch it.

**Fix, on each kiosk machine:**

1. Set Windows' own default printer (Settings → Printers & scanners) to the physical slip/label
   printer — not "Microsoft Print to PDF" or any other virtual printer.
2. Open the same print page once with a normal `Ctrl+P` (not the kiosk shortcut), confirm the
   destination is that printer, set margins to **None** and scale to **100%** (match the
   document's own `@page` size — don't rely on "Fit to page"), and actually print once. Chrome
   carries these settings forward into subsequent `--kiosk-printing` silent prints on that profile.
3. Re-test via the normal kiosk shortcut.

If multiple printers are attached to one kiosk machine (e.g. a label printer and a document
printer for different pages in this app), `--kiosk-printing` can only ever target Chrome's single
current default — it cannot route different print pages to different printers. For that scenario,
either keep per-purpose machines each with one printer set default, or move to the alternative
below.

## A more robust alternative: silent printing via a local print agent

If per-machine Chrome/registry configuration proves too fragile to maintain (new machines, printer
swaps, drivers resetting the default), a local print agent such as **QZ Tray** lets the app print
directly to a *named* printer over a local WebSocket connection, bypassing the browser dialog and
Chrome's own default-printer concept entirely. This requires installing QZ Tray (or similar) on
every print station and adding integration code to the app (not present today) — a larger change,
worth doing only if the registry-policy fix above doesn't hold up operationally across the
warehouse's machines.
