## REMOVED Requirements

### Requirement: Launch shows the mark on the shell paper color with no flash

**Reason**: The shell has light and dark canvases, and the mark becomes the ember.
**Migration**: See "Launch shows the ember on the scheme's canvas with no flash".

## ADDED Requirements

### Requirement: Launch shows the ember on the scheme's canvas with no flash
Both apps SHALL show the ember mark centred on the launch background for the phone's scheme while launching, and SHALL hold the launch screen until the launcher draws its first frame, then cross-fade. The launch backgrounds SHALL equal the token module's light and dark `bg`, and the release checks SHALL fail when `brand.json` disagrees with either. On Android 12 and later the system splash's icon mask applies. Android SHALL do this without a new dependency.

#### Scenario: Cold start in dark mode has no colour jump
- **WHEN** the user cold-starts either app with the phone in dark mode
- **THEN** the screen goes from the ember on the dark `bg` straight to Home's first frame, with no white or black frame between

#### Scenario: Brand colour drifts from the tokens
- **WHEN** `brand.json` sets the dark launch background to `#000000` while the dark `bg` is `#100E0D`
- **THEN** the release checks fail, showing both values

### Requirement: The app icon is the ember on warm dark
The foreground mark SHALL be the ember silhouette, generated with the icon set on a warm dark background (`#1A1614` to `#2A2420`), with iOS dark and tinted variants and an Android monochrome layer drawn from the silhouette. Before it becomes the icon the silhouette SHALL pass the owner's 24 pt grey legibility check.

#### Scenario: A themed icon shows the flame
- **WHEN** themed icons are on in Android 13
- **THEN** the launcher shows the ember silhouette as Whim's monochrome icon
