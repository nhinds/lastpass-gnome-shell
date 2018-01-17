# LastPass Gnome-Shell Extension

Types passwords from LastPass into applications inside Gnome-Shell

## Current Status

Implemented:

* Indicator icon with menu item which types a value into the current application in Gnome-Shell under X11 or Wayland
* LastPass library for GJS
* Login to LastPass
* Menu to select arbitrary password to type into apps
* Persistent settings for 'Favourite' passwords to display in the menu
* Remember the username to use for logging in
* Caching the vault
* Ability to reload vault from LastPass when things change

TODO:

* Persistent settings for the typing speed / delays
* Nicer feedback after submitting username+password while waiting for the HTTP request
* "Remember password" setting which keeps the unlocked vault in memory for 5 minutes
* Un-caching the vault after a configurable amount of time (e.g. automatically refresh every day)
* Ability to perform an "offline login" to override the automatic refresh
