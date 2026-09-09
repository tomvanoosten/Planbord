# Planboard

## Nieuwe gedeelde versie

Teams, gastprofielen, ontvangers per alarm, gedeelde opslag en achtergrondmeldingen zijn voorbereid.
Volg **[SETUP-SHARED.md](SETUP-SHARED.md)** voor de database, Pages Functions en de geplande Worker.
De huidige online installatie verandert pas na upload en configuratie.
De onderstaande beschrijving betreft de lokale modus; de gedeelde modus gebruikt de server.

A compact, Microsoft Lists-inspired project board. No build step, account, or backend is needed for editing the board.

## Open

Open `index.html` in your browser. If an older version is already open, refresh with Ctrl+F5.

The grey columns scroll horizontally. Click a white card to edit it, click a column heading for its options, and use + to add a project to that column. Drag cards to move them; the column selector in the project dialog also works with keyboard and touch.

## Features

- Project names and long comments, with comments shown in the project dialog.
- A date picker and advance warning in calendar days (default 1; 0 means the same day). Date reminders fire at 09:00 local time.
- Independent date/time reminder per project, editable and clearable.
- Column renaming, insertion left/right, and confirmed deletion. Cards from a deleted column move to the first remaining column.
- Per-card column reminders after a configurable number of days. Moving a card restarts its stay timer.
- Editable labels for project name, comments, date and advance warning through **Veldnamen**.
- Search, drag-and-drop and a notification inbox. Notifications open their project.
- Five-second in-app alerts. Desktop alerts are also asked to close after five seconds; Windows/browser settings can affect delivery and display timing.
- **Testmelding** sends an immediate alert for the first project.
- Saved data is kept under the original `planboard-state` key. Existing projects are preserved.

## Reminder limitations

The page must remain open for timers to run. Sleeping devices and suspended tabs can delay alerts; overdue reminders are checked again when the page regains focus or is reopened. Closed-browser delivery requires a server scheduler and web push, which are not part of this frontend.

Desktop notifications require permission and a supported secure context (HTTPS or localhost). The rest of the board and its in-app alerts work without that permission. Data is local to this browser and is not shared between devices or colleagues.

## Verification

Run `node --test tests.cjs`. The tests cover state migration, reminder scheduling, editing handlers, persistence, column operations, notifications, and the hidden-dialog regression. These are Node-based tests, not rendered browser tests.

## Static hosting

For the complete updated deployment, follow SETUP-SHARED.md and upload the contents of planboard-shared-upload.zip. The existing site is https://planbord-285.pages.dev/. New account bindings and secrets have not been configured by this task.
