# Chrome Stream Layout Privacy Policy

Effective date: July 14, 2026

Chrome Stream Layout (the “Extension”) respects your privacy. This policy explains what information the Extension processes, why it is processed, and how it is stored and shared.

## Information Collection

The Extension does not collect, sell, or transmit personally identifiable information. It does not use advertising, tracking, or analytics services.

The Extension stores settings required for its operation on your device, including:

- Stream or video source URLs that you enter
- The number, arrangement, and sizes of panes
- Interface and playback preferences

These settings are stored using Chrome's local extension storage. The Extension does not send them to the developer or to a server controlled by the developer. You can delete this information by clearing the Extension's data or uninstalling the Extension.

## Websites and Third-Party Services

When you add a stream or video URL to the layout, the Extension loads content from that website directly in Chrome. The website may receive information normally included in web requests, such as your IP address, browser information, cookies, or sign-in status, and may process that information under its own privacy policy. The Extension does not control how third-party websites process information.

If you add a Bilibili live-stream URL, the Extension sends the room number contained in that URL to Bilibili's official API to resolve the actual room number and construct the player URL. This request does not include sign-in credentials, but it remains subject to Bilibili's terms of service and privacy policy.

The Extension does not bypass paywalls, account permissions, digital rights management (DRM), or other content-protection mechanisms.

## Permission Usage

The Extension uses the following Chrome permissions:

- `storage`: Stores and restores layout settings, source URLs, and interface preferences on your device.
- `tabs`: Creates, locates, and focuses the Extension's own layout tab to avoid opening duplicate tabs.
- `declarativeNetRequest` and `declarativeNetRequestWithHostAccess`: Apply temporary rules only to subframe requests in the Extension's layout tab so that user-selected sources can be displayed in the multi-pane layout.
- Host access: Loads HTTP or HTTPS stream and video sources selected by the user and provides playback and layout assistance inside embedded frames on selected supported websites.

The Extension does not use these permissions to collect your browsing history or transmit the contents of ordinary browsing tabs to the developer.

## Information Sharing

Except for websites that you choose to load and the Bilibili API request described above, the Extension does not sell, rent, or share information with the developer, advertisers, data brokers, or other third parties.

## Data Security and Retention

Chrome stores your layout settings on your device. The settings remain there according to your Chrome configuration until you clear the Extension's data or uninstall the Extension. While reasonable efforts are made to maintain the security of the Extension, no software or method of network transmission can be guaranteed to be completely secure.

## Children's Privacy

The Extension is not directed primarily at children and does not knowingly collect personal information from children.

## Changes to This Policy

This policy may be updated when the Extension's features, legal requirements, or data-processing practices change. The effective date shown on this page will be revised when an update is made. Material changes will be communicated through an appropriate channel.

## Contact

If you have questions about this privacy policy, contact the developer through the project's GitHub Issues page:

https://github.com/ha850411/chrome-stream-layout/issues
