# LastPass Gnome-Shell Extension

Types passwords from LastPass into applications inside Gnome-Shell

## Current Status

Implemented:

* Indicator icon with menu item which types a value into the current application in Gnome-Shell under X11 or Wayland
* LastPass library for GJS
* Login to LastPass
* Menu to select arbitrary password to type into apps

TODO:

* Persistent settings for 'Favourite' passwords to display in the menu and the typing speed / delays
* Ability to reload vault from LastPass when things change
* Nicer feedback after submitting username+password while waiting for the HTTP request
* Remember the username to use for logging in
* "Remember password" setting which keeps the unlocked vault in memory for 5 minutes
