// HTML for the README's device mockups: an iPhone-like frame around a 390×844 screen (the harness's phone views),
// upright or on its side. compose.ts lays these out and shoots them with a transparent background.

export const SCREEN = { height: 844, width: 390 }

const STATUS_BAR = `
<div class="status">
  <span class="time">9:41</span>
  <span class="icons">
    <svg width="19" height="12" viewBox="0 0 19 12"><rect x="0" y="8" width="3.2" height="4" rx="0.8"/><rect x="5" y="5.5" width="3.2" height="6.5" rx="0.8"/><rect x="10" y="3" width="3.2" height="9" rx="0.8"/><rect x="15" y="0" width="3.2" height="12" rx="0.8"/></svg>
    <svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.3c2.5 0 4.7 1 6.4 2.6l1.2-1.2C14.1 1.8 11.4.6 8.5.6S2.9 1.8.9 3.7l1.2 1.2C3.8 3.3 6 2.3 8.5 2.3Zm0 3.4c1.5 0 2.9.6 3.9 1.6l1.2-1.2C12.3 4.8 10.5 4 8.5 4s-3.8.8-5.1 2.1l1.2 1.2c1-1 2.4-1.6 3.9-1.6Zm0 3.4c-.6 0-1.1.2-1.5.6L8.5 11.2 10 9.7c-.4-.4-.9-.6-1.5-.6Z"/></svg>
    <svg width="28" height="13" viewBox="0 0 28 13"><rect x="0.5" y="0.5" width="24" height="12" rx="3.8" fill="none" stroke="currentColor" stroke-opacity="0.4"/><rect x="2" y="2" width="21" height="9" rx="2.5"/><path d="M26 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill-opacity="0.4"/></svg>
  </span>
</div>`

export const CSS = `
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; }
body { font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif; }
.phone { position: absolute; padding: 13px; border-radius: 68px;
  background: linear-gradient(145deg, #5a5d63, #2b2d31 30%, #44474c 60%, #232427);
  box-shadow: 0 30px 60px -20px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.6) inset; transform-origin: top left; }
.phone::before { content: ''; position: absolute; inset: 3px; border-radius: 65px; background: #050505; }
.screen { position: relative; width: ${SCREEN.width}px; height: ${SCREEN.height}px; border-radius: 55px; overflow: hidden;
  background: #000; }
.land .screen { width: ${SCREEN.height}px; height: ${SCREEN.width}px; }
.screen > img { position: absolute; left: 0; top: 0; display: block; width: 100%; }
.island { position: absolute; top: 11px; left: 50%; transform: translateX(-50%); width: 122px; height: 35px;
  border-radius: 18px; background: #000; z-index: 3; }
.land .island { top: 50%; left: 11px; transform: translateY(-50%); width: 35px; height: 122px; }
.home { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); width: 134px; height: 5px;
  border-radius: 3px; background: rgba(255,255,255,.85); z-index: 3; }
.land .home { width: 200px; bottom: 6px; }
.btn { position: absolute; background: linear-gradient(90deg, #2b2d31, #55585e); border-radius: 2px; }
.status { position: absolute; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center;
  justify-content: space-between; padding: 6px 32px 0 50px; color: #fff; z-index: 2; }
.status .time { font-weight: 600; font-size: 17px; letter-spacing: -0.2px; }
.status .icons { display: flex; gap: 6px; align-items: center; fill: currentColor; }
`

// Side buttons: action and volume on the left, power on the right (on the top and bottom edges when on its side)
const BUTTONS = {
  land: `<i class="btn" style="top:-3px;left:150px;width:30px;height:4px"></i><i class="btn" style="top:-3px;left:200px;width:60px;height:4px"></i><i class="btn" style="top:-3px;left:275px;width:60px;height:4px"></i><i class="btn" style="bottom:-3px;left:230px;width:95px;height:4px"></i>`,
  upright: `<i class="btn" style="left:-3px;top:150px;width:4px;height:30px"></i><i class="btn" style="left:-3px;top:200px;width:4px;height:60px"></i><i class="btn" style="left:-3px;top:275px;width:4px;height:60px"></i><i class="btn" style="right:-3px;top:230px;width:4px;height:95px"></i>`,
}

/** A phone at (x, y), scaled; `layers` are the screen's images, bottom first, each `src` with an optional clip height */
export const phone = (opts: {
  id: string
  land?: boolean
  layers: { src: string; id?: string }[]
  scale: number
  x: number
  y: number
}) => {
  const land = opts.land === true
  const images = opts.layers
    .map(
      (layer) =>
        `<img src="${layer.src}"${layer.id === undefined ? '' : ` id="${layer.id}"`}>`
    )
    .join('')
  return `<div class="phone${land ? ' land' : ''}" id="${opts.id}" style="left:${opts.x}px;top:${opts.y}px;transform:scale(${opts.scale})">
    ${land ? BUTTONS.land : BUTTONS.upright}
    <div class="screen">${images}${land ? '' : STATUS_BAR}<div class="island"></div><div class="home"></div></div>
  </div>`
}

/** The frame's outer size at scale 1, padding included */
export const outer = (land: boolean) =>
  land
    ? { height: SCREEN.width + 26, width: SCREEN.height + 26 }
    : { height: SCREEN.height + 26, width: SCREEN.width + 26 }
