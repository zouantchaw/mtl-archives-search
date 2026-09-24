import { expect, it } from 'vitest'
import { buildProjection } from './projection'
import { itemFromPoint } from './records'

it('keeps archival attribution and caption provenance when opening a snapshot point', () => {
  const index = buildProjection([{ id: 'photo.json', x: .2, y: .3, name: 'Rue', date: '1932', imageUrl: 'https://example.test/photo.jpg', caption: 'A street', captionModel: 'caption-model', cote: 'VM94', credits: 'Archives de Montréal', externalUrl: 'https://example.test/source' }])
  expect(itemFromPoint(index.byId.get('photo.json')!)).toMatchObject({ sourceTitle: 'Rue', year: 1932, cote: 'VM94', credits: 'Archives de Montréal', externalUrl: 'https://example.test/source', captionModel: 'caption-model', placement: 'projected' })
})
