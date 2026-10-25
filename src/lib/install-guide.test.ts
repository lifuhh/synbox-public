import { describe, expect, test } from 'vite-plus/test'

import { installGuide } from './install-guide'

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidEdge:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0',
  androidFirefox:
    'Mozilla/5.0 (Android 14; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  instagramIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone15,2; iOS 18_6; en_US)',
  // iPadOS asks for desktop sites with a Mac's user agent
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/123.0.0.0',
  safariMac16:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
}

const names = (ua: string, touchPoints = 0) =>
  installGuide(ua, touchPoints).steps.map((step) => step.name)
const openIn = (ua: string, touchPoints = 0) =>
  installGuide(ua, touchPoints).openIn

describe('installGuide', () => {
  test('iPhone browsers add to the Home Screen from Share, wherever each keeps it', () => {
    expect(names(UA.iphoneSafari)).toEqual([
      'Share',
      'Add to Home Screen',
      'Add',
    ])
    expect(installGuide(UA.iphoneChrome, 5).steps[0].note).toBe(
      'right of the address bar'
    )
    expect(installGuide(UA.iphoneFirefox, 5).steps[0].note).toBe('in the menu')
  })

  test('an iPad passing as a Mac is told the iPad’s steps, a Mac’s Safari the Dock’s', () => {
    expect(names(UA.ipadSafari, 5)).toContain('Add to Home Screen')
    expect(names(UA.ipadSafari, 0)).toEqual(['File › Add to Dock', 'Add'])
  })

  test('Chromium browsers each get their own menu, not Chrome’s', () => {
    expect(names(UA.chromeMac)).toContain('Install page as app…')
    expect(names(UA.edgeWindows)).toContain('Install this site as an app')
    expect(names(UA.androidChrome)).toContain('Install and create shortcut')
    expect(names(UA.samsung)).toEqual(['Menu', 'Add page to', 'Home screen'])
    expect(names(UA.androidFirefox)).toContain('Add to Home screen')
  })

  test('a browser that can’t install is sent to one that can', () => {
    expect(openIn(UA.firefoxWindows)).toBe('Chrome or Edge')
    expect(openIn(UA.firefoxMac)).toBe('Safari or Chrome')
    expect(openIn(UA.safariMac16)).toBe('Safari or Chrome')
    expect(openIn(UA.operaWindows)).toBe('Chrome or Edge')
    expect(openIn(UA.androidEdge)).toBe('Chrome')
  })

  test('an app’s own browser view is left for the phone’s browser first', () => {
    expect(openIn(UA.instagramIphone, 5)).toBe('Safari')
    expect(names(UA.instagramIphone, 5)).toContain('Open in Safari')
    expect(openIn(UA.androidWebView)).toBe('Chrome')
    expect(openIn(UA.iphoneSafari)).toBeUndefined()
  })
})
