import { defineComponent, h } from 'vue'

// Compatibility exports: existing callers keep their names while every icon uses
// the same 24px SVG grid, stroke weight and currentColor. No font loading needed.
const icon = (name: string, path: string, filled = false) =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () =>
        h(
          'svg',
          {
            ...attrs,
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            width: '1em',
            height: '1em',
            fill: filled ? 'currentColor' : 'none',
            stroke: 'currentColor',
            'stroke-width': 1.7,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false',
            class: ['app-icon', attrs.class],
          },
          [h('path', { d: path })]
        )
    },
  })
export const ArrowDown = icon('ArrowDown', 'm6 9 6 6 6-6')
export const ChevronRight = icon('ChevronRight', 'm9 6 6 6-6 6')
export const ChevronUp = icon('ChevronUp', 'm6 15 6-6 6 6')
export const ArrowLeft = icon('ArrowLeft', 'M19 12H5m6-6-6 6 6 6')
export const ArrowRight = icon('ArrowRight', 'M5 12h14m-6-6 6 6-6 6')
export const ArrowUp = icon('ArrowUp', 'M12 19V5m-6 6 6-6 6 6')
export const ArrowDownToLine = icon('ArrowDownToLine', 'M12 3v12m-5-5 5 5 5-5M5 20h14')
export const ArrowUpFromLine = icon('ArrowUpFromLine', 'M12 17V5m-5 5 5-5 5 5M5 21h14')
export const ChevronsDown = icon('ChevronsDown', 'm6 5 6 6 6-6m-12 8 6 6 6-6')
export const ChevronsUp = icon('ChevronsUp', 'm6 19 6-6 6 6m-12-8 6-6 6 6')
export const Archive = icon('Archive', 'M4 8h16v12H4zM3 4h18v4H3zM9 12h6')
export const Back = icon('Back', 'M9 5 3 11l6 6M3 11h11a6 6 0 0 1 0 12')
export const Brush = icon('Brush', 'm14 4 6 6M4 14l10-10 6 6-10 10H4zM4 17l3 3')
export const Calendar = icon('Calendar', 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16')
export const ChatLineSquare = icon('ChatLineSquare', 'M4 4h16v13H9l-5 4zM8 8h8M8 12h5')
export const Check = icon('Check', 'm5 12 4 4L19 6')
export const CircleCheck = icon('CircleCheck', 'M21 11a9 9 0 1 1-6-8m-7 9 4 4L22 5')
export const Close = icon('Close', 'm6 6 12 12M6 18 18 6')
export const Code = icon('Code', 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18')
export const Connection = icon('Connection', 'M4 4h6v16H4zm10 0h6v16h-6M7 8v8m10-8v8')
export const CopyDocument = icon('CopyDocument', 'M8 8h12v13H8zM16 8V3H3v13h5')
export const Delete = icon('Delete', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7')
export const Document = icon('Document', 'M5 3h9l5 5v13H5zM14 3v6h5M9 13h6m-6 4h6')
export const FileCode = icon('FileCode', 'M5 3h9l5 5v13H5zM14 3v5h5m-9 4-3 3 3 3m4-6 3 3-3 3')
export const FileAsset = icon(
  'FileAsset',
  'M5 3h9l5 5v13H5zM14 3v5h5m-7 4 4 2v4l-4 2-4-2v-4zm-4 2 4 2 4-2m-4 2v4'
)
export const FileImage = icon('FileImage', 'M4 4h16v16H4zm0 12 5-5 4 4 3-3 4 4M15 8h.01')
export const Download = icon('Download', 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5')
export const Edit = icon('Edit', 'm15 4 5 5M4 15 15 4l5 5L9 20H4z')
export const Folder = icon('Folder', 'M3 6V4h7l2 3h9v13H3z')
export const FolderOpened = icon('FolderOpened', 'M3 10V5h7l2 3h8v3M3 20l3-9h16l-3 9z')
export const GitBranch = icon(
  'GitBranch',
  'M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4m12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 7v10m12-10v2a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 4'
)
export const Warning = icon('Warning', 'm12 3 10 18H2zM12 9v5m0 3v.1')
export const HomeFilled = icon('HomeFilled', 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8')
export const InfoFilled = icon('InfoFilled', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6m0-10v.1')
export const Link = icon(
  'Link',
  'm10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'
)
export const List = icon('List', 'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1')
export const History = icon('History', 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2')
export const Layers = icon('Layers', 'm12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5')
export const Loading = icon('Loading', 'M21 12a9 9 0 1 1-9-9')
export const Minus = icon('Minus', 'M5 12h14')
export const Monitor = icon('Monitor', 'M3 4h18v13H3zM12 17v4m-5 0h10')
export const MoreFilled = icon('MoreFilled', 'M5 12h.1M12 12h.1M19 12h.1')
export const Moon = icon('Moon', 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z')
export const Plus = icon('Plus', 'M12 5v14M5 12h14')
export const PriceTag = icon('PriceTag', 'M3 3h9l9 9-9 9-9-9zM7 7h.1')
export const Refresh = icon(
  'Refresh',
  'M21 4v6h-6M3 20v-6h6M5 7a8 8 0 0 1 13-2l3 5M3 14l3 5a8 8 0 0 0 13-2'
)
export const RefreshLeft = icon('RefreshLeft', 'M3 4v6h6M3 10a9 9 0 1 1 1 8')
export const RefreshRight = icon('RefreshRight', 'M21 4v6h-6M21 10a9 9 0 1 0-1 8')
export const Setting = icon(
  'Setting',
  'm9 3-.5 3-2 1-3-.5-2 3 2.5 2.5v2L1.5 16l2 3 3-.5 2 1L9 22h6l.5-2.5 2-1 3 .5 2-3-2.5-2v-2L22.5 9l-2-3-3 .5-2-1L15 3zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
)
export const Search = icon('Search', 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6')
export const Sunny = icon(
  'Sunny',
  'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1'
)
export const Switch = icon('Switch', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18')
export const Terminal = icon('Terminal', 'M3 4h18v16H3zm4 4 4 4-4 4m7 0h3')
export const Upload = icon('Upload', 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5')
export const User = icon('User', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2')
export const PanelLeft = icon('PanelLeft', 'M3 4h18v16H3zm5 0v16')
const star = 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z'
export const Star = icon('Star', star)
export const StarFilled = icon('StarFilled', star, true)
export const ExpandAll = icon('ExpandAll', 'm8 8 4-4 4 4m-8 8 4 4 4-4M4 12h16')
export const CollapseAll = icon('CollapseAll', 'm8 3 4 4 4-4m-8 18 4-4 4 4M4 12h16')
export const TreeView = icon('TreeView', 'M4 3v14h4M4 8h4m3-4h10v7H11zm0 11h10v7H11z')

export const Eye = icon(
  'Eye',
  'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
)
export const EyeOff = icon(
  'EyeOff',
  'm3 3 18 18M10 5a12 12 0 0 1 12 7 17 17 0 0 1-4 5M6 6a18 18 0 0 0-4 6s4 7 10 7c2 0 4-.6 5-1.5M9 9a4 4 0 0 0 6 6'
)
