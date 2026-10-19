// @vitest-environment happy-dom
import { act, createRef, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { FILL_WINDOW } from '@/lib/karaoke'
import type { KaraokeDocLine, KaraokeToken } from '@/types'

import type { KaraokeLineHandle } from './KaraokeLine'
import { KaraokeLine } from './KaraokeLine'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const mora = (kana: string, start: number, end: number) => ({
  end,
  kana,
  romaji: '',
  start,
})

const token = (
  surface: string,
  ruby: KaraokeToken['ruby'],
  morae: KaraokeToken['morae'],
  isLatin = false
): KaraokeToken => ({ is_latin: isLatin, morae, reading: '', ruby, surface })

// An invented line: kanji with ruby, okurigana, 、 and a Latin word
const line: KaraokeDocLine = {
  checks: ['anchor', 'onset_set'],
  end: 36.2,
  furigana: '空[そら]よりも、輝[かがや]くLemon',
  romaji: 'sora yori mo kagayaku lemon',
  start: 30.8,
  status: 'verified',
  text: '空よりも、輝くLemon',
  tokens: [
    token(
      '空',
      [{ base: '空', rt: 'そら' }],
      [mora('そ', 30.8, 31.05), mora('ら', 31.05, 31.3)]
    ),
    token(
      'よりも',
      [{ base: 'よりも', rt: '' }],
      [mora('よ', 31.3, 31.5), mora('り', 31.5, 31.7), mora('も', 31.7, 31.9)]
    ),
    token('、', [{ base: '、', rt: '' }], []),
    token(
      '輝く',
      [
        { base: '輝', rt: 'かがや' },
        { base: 'く', rt: '' },
      ],
      [
        mora('か', 32, 32.2),
        mora('が', 32.2, 32.4),
        mora('や', 32.4, 32.6),
        mora('く', 32.6, 32.8),
      ]
    ),
    token('Lemon', [], [mora('Lemon', 33, 34)], true),
  ],
}

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

const renderLine = () => {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const handle = createRef<KaraokeLineHandle>()
  const renders = { count: 0 }
  act(() => {
    root.render(
      <Profiler
        id='karaoke'
        onRender={() => {
          renders.count += 1
        }}>
        <KaraokeLine ref={handle} line={line} />
      </Profiler>
    )
  })
  const parts = [
    ...container.querySelectorAll<HTMLElement>('.lyric-karaoke-part'),
  ]
  const fills = () =>
    parts.map((el) => Number(el.style.getPropertyValue('--p') || 0))
  return { container, fills, handle, parts, renders }
}

describe('KaraokeLine', () => {
  test('renders one part per ruby segment, ruby only where a segment has rt', () => {
    const { container: root, parts } = renderLine()
    expect(parts.map((el) => el.textContent)).toEqual([
      '空そら',
      'よりも',
      '、',
      '輝かがや',
      'く',
      'Lemon',
    ])
    expect(
      [...root.querySelectorAll('ruby')].map((ruby) => [
        ruby.firstChild?.textContent,
        ruby.querySelector('rt')?.textContent,
      ])
    ).toEqual([
      ['空', 'そら'],
      ['輝', 'かがや'],
    ])
    expect(parts[5]?.querySelector('ruby')).toBeNull()
  })

  test('setTime lights each mora from its onset, per part, without re-rendering', () => {
    const { fills, handle, renders } = renderLine()
    const rendersAfterMount = renders.count

    handle.current?.setTime(30.8 + FILL_WINDOW + 0.001) // だ lit, れ not yet
    expect(fills()).toEqual([0.5, 0, 0, 0, 0, 0])

    handle.current?.setTime(32.4 + FILL_WINDOW + 0.001) // 輝 (か が や) done, く not started
    expect(fills()).toEqual([1, 1, 1, 1, 0, 0])

    handle.current?.setTime(33.5) // Lemon fills across its whole span
    expect(fills()[5]).toBeCloseTo(0.5)

    expect(renders.count).toBe(rendersAfterMount)
  })
})
