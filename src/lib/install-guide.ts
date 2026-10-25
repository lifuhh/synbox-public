// How to install the app in a browser that has no install prompt to open (or has used it up): the steps in that
// browser's own words, from its vendor's help pages (docs/log/2026-10-25-feat-install-guide.md lists them), or which
// browser to open instead where this one can't install at all

// The icons a step's control shows on screen, where the vendor's control has one
export type StepIcon =
  | 'share'
  | 'more'
  | 'more-vertical'
  | 'menu'
  | 'add-square'

export interface InstallStep {
  verb: 'Tap' | 'Click' | 'Choose'
  // The control's name as the browser labels it
  name: string
  icon?: StepIcon
  // Where to find it, when it isn't in plain sight
  note?: string
}

export interface InstallGuide {
  // Set where this browser can't install: the one to open the site in instead
  openIn?: string
  steps: InstallStep[]
}

// Apps that open links in their own browser view, which has no way to install a site
const IN_APP =
  /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Pinterest|GSA\//u

// The app's own menu, then its way out to a full browser (the label differs from app to app)
const leaveApp = (browser: string): InstallGuide => ({
  openIn: browser,
  steps: [
    { icon: 'more', name: 'Menu', verb: 'Tap' },
    { name: `Open in ${browser}`, note: 'or Open in Browser', verb: 'Choose' },
  ],
})

const ADD_TO_HOME_SCREEN: InstallStep = {
  icon: 'add-square',
  name: 'Add to Home Screen',
  verb: 'Choose',
}
const ADD: InstallStep = { name: 'Add', verb: 'Tap' }

const iosGuide = (ua: string): InstallGuide => {
  if (IN_APP.test(ua)) {
    return leaveApp('Safari')
  }
  // Chrome, Edge and Firefox on iOS add to the Home Screen from the system's Share sheet, as Safari does
  if (/CriOS/u.test(ua)) {
    return {
      steps: [
        {
          icon: 'share',
          name: 'Share',
          note: 'right of the address bar',
          verb: 'Tap',
        },
        ADD_TO_HOME_SCREEN,
        ADD,
      ],
    }
  }
  if (/FxiOS|EdgiOS|OPiOS/u.test(ua)) {
    return {
      steps: [
        { icon: 'share', name: 'Share', note: 'in the menu', verb: 'Tap' },
        ADD_TO_HOME_SCREEN,
        ADD,
      ],
    }
  }
  // Safari puts Share behind ⋯ in its compact layout (iOS 26)
  return {
    steps: [
      { icon: 'share', name: 'Share', note: 'or ⋯ › Share', verb: 'Tap' },
      ADD_TO_HOME_SCREEN,
      ADD,
    ],
  }
}

const androidGuide = (ua: string): InstallGuide => {
  // `; wv)`: an app's own web view
  if (IN_APP.test(ua) || /; wv\)/u.test(ua)) {
    return leaveApp('Chrome')
  }
  if (/SamsungBrowser/u.test(ua)) {
    return {
      steps: [
        { icon: 'menu', name: 'Menu', verb: 'Tap' },
        { name: 'Add page to', verb: 'Choose' },
        { name: 'Home screen', verb: 'Choose' },
      ],
    }
  }
  if (/Firefox/u.test(ua)) {
    return {
      steps: [
        { icon: 'more-vertical', name: 'Menu', verb: 'Tap' },
        { name: 'Add to Home screen', verb: 'Choose' },
        ADD,
      ],
    }
  }
  if (/Chrome/u.test(ua) && !/EdgA|OPR|YaBrowser/u.test(ua)) {
    return {
      steps: [
        { icon: 'more-vertical', name: 'More', verb: 'Tap' },
        { name: 'Install and create shortcut', verb: 'Choose' },
        { name: 'Install', verb: 'Tap' },
      ],
    }
  }
  return { openIn: 'Chrome', steps: [] }
}

const desktopGuide = (ua: string): InstallGuide => {
  const mac = /Macintosh/u.test(ua)
  if (/Edg\//u.test(ua)) {
    return {
      steps: [
        { icon: 'more', name: 'Settings and more', verb: 'Click' },
        { name: 'More tools › Apps', verb: 'Choose' },
        { name: 'Install this site as an app', verb: 'Choose' },
      ],
    }
  }
  if (/Chrome\//u.test(ua) && !/OPR|YaBrowser/u.test(ua)) {
    return {
      steps: [
        { icon: 'more-vertical', name: 'More', verb: 'Click' },
        { name: 'Cast, save, and share', verb: 'Choose' },
        { name: 'Install page as app…', verb: 'Choose' },
      ],
    }
  }
  // Safari 17 (macOS Sonoma) and later make web apps for the Dock
  const safari = /Version\/(?<major>\d+)[\d.]* Safari/u.exec(ua)
  if (mac && safari !== null && Number(safari.groups?.major) >= 17) {
    return {
      steps: [
        {
          name: 'File › Add to Dock',
          note: 'or Share › Add to Dock',
          verb: 'Choose',
        },
        { name: 'Add', verb: 'Click' },
      ],
    }
  }
  return { openIn: mac ? 'Safari or Chrome' : 'Chrome or Edge', steps: [] }
}

// `touchPoints`: an iPad reports itself as a Mac, and only its touch screen gives it away
export const installGuide = (ua: string, touchPoints: number): InstallGuide => {
  if (
    /iPhone|iPad|iPod/u.test(ua) ||
    (/Macintosh/u.test(ua) && touchPoints > 1)
  ) {
    return iosGuide(ua)
  }
  return /Android/u.test(ua) ? androidGuide(ua) : desktopGuide(ua)
}
