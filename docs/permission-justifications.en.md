# Chrome Web Store Permission Justifications

## `declarativeNetRequest`

This permission is used to create temporary network rules that apply only to the extension's layout tab. The rules adjust frame-related restrictions so that stream or video sources selected by the user can be displayed in the multi-pane layout. They process only subframe requests and are not used to collect, read, or store the user's browsing activity.

## `declarativeNetRequestWithHostAccess`

Users may enter stream or video URLs from different websites. This permission is therefore required together with host access to apply temporary rules to subframe requests inside the extension's layout tab. These rules remove response headers that prevent iframe display and set the required request referrer for YouTube embeds. The rules are restricted to the extension's layout tab.

## `storage`

This permission is used to save layout settings on the user's device, including source URLs, pane count, layout, pane sizes, and interface preferences. This allows the extension to restore the user's previous layout when it is opened again. The data is stored only in Chrome's local extension storage and is not sent to an external server.

## `tabs`

This permission is used to open the extension's layout tab, check whether that tab is already open, and focus the existing tab when the user clicks the toolbar icon again. This prevents duplicate layout tabs. The extension does not collect or transmit the browsing history of other tabs.

## Host access

Users may add stream and video URLs from different websites to the multi-pane layout. Access to HTTP and HTTPS websites is required to load the sources selected by the user and to apply the necessary embedding rules only to subframes in the extension's layout tab. Host access is also used to run playback and layout helpers inside embedded frames on selected supported websites. The extension does not collect, analyze, or transmit content from ordinary browsing tabs.
