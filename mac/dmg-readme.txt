Porchlight
=========

Drag Porchlight into Applications, then open it from there.

It needs a Mac with Apple silicon (M1 or later) and macOS 13.5 or later.


The first time you open it
--------------------------

Porchlight is not from the App Store and is not notarized by Apple, so macOS stops it the first
time with "Porchlight Not Opened". To open it:

1. Choose Done.
2. Open System Settings → Privacy & Security, scroll down to "Porchlight was blocked", and choose
   Open Anyway. Confirm with your password or Touch ID.

Or, in Terminal:

    xattr -dr com.apple.quarantine /Applications/Porchlight.app

After that it opens like any other app.


What it needs
-------------

- git, from Apple's command line tools. If they are missing, macOS offers to install them the
  first time a scan runs. You can also run: xcode-select --install
- Nothing else. The app carries its own Node.js, gitleaks and osv-scanner. If you install newer
  ones with Homebrew (brew install gitleaks osv-scanner), it uses those instead.


Where things are kept
---------------------

Everything Porchlight keeps (reports, history, your notes, settings) is in ~/.porchlight, readable
only by you. Its log is ~/.porchlight/app.log (Porchlight → Show Log).

Optional settings, such as the folder to scan or the address of your domain monitor, go in
~/.porchlight/app.env. See:
https://github.com/AES256Afro/Porchlight/blob/main/mac/app.env.example

The model and the look are chosen inside the app, under Settings.


Licences
--------

Node.js, gitleaks and osv-scanner are included under their own licences, in
Porchlight.app/Contents/Resources/licenses.

Source, documentation and issues: https://github.com/AES256Afro/Porchlight
