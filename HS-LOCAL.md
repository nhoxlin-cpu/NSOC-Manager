# HS compares the phone's cached history

HS normalizes and counts against the SQLite workspace already on the phone/browser. A committed scan returns the durable local result with `duplicate_scope: device` immediately. It never awaits server sync, never merges the server's duplicate count into this response, and sync receipts never overwrite the HS row's local `prior_count`. Existing raw-label rules and the explicit repeat action remain unchanged.

The scanner shows green **Không trùng** or red **Trùng**, including while uploads are pending. The amber provisional banner still applies to the other business workflows; it does not suppress a completed device HS comparison. The Watch receives the actual device result with its existing event ID and raw/canonical code; a local nonduplicate is informational, not an invented quality PASS.

The comparison uses whatever history is currently cached in this workspace. An intentional snapshot refresh changes that available history. The server can store its own aggregate scan history, but its receipt does not decide the current phone HS result. Without a usable local workspace the app asks the user to initialize it instead of falling back to a server HS decision. Upload failures retain the durable outbox and do not stop the camera.

Validation: browser with a 95,000-row MM snapshot, a deliberately unresolved sync promise, local green/red camera states during a server outage, an injected conflicting server prior-count of 999, durable restart, and the full offline module/replay regression. Physical camera performance varies by phone; the automated camera feed is a fixture.
