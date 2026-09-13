import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, buildSearchText } from './repair-lib.mjs';
const row = { metadata_filename: 'a', image_filename: 'a.jpg', external_url: 'https://archive.test/Image.jpg', name: 'Church', description: 'Original evidence', portal_description: 'Portal evidence' };
test('safe alias transfers caption; conflicting alias does not overwrite direct image caption', () => {
  const result = reconcile([row], [{...row, dedupe_metadata_filenames:['a','b']}], [
    {...row,vlm_caption:'A church'}, {...row,metadata_filename:'b',image_filename:'b.jpg',vlm_caption:'A tree'}]);
  assert.equal(result.aliases.b,'a'); assert.equal(result.rows[0].vlm_caption,'A church');
  assert.equal(result.rows[0].caption_status,'unreviewed_conflict');
});
test('ambiguous alias-only captions remain missing', () => {
  const result=reconcile([row],[{...row,dedupe_metadata_filenames:['b','c']}],['b','c'].map((id,i)=>({...row,metadata_filename:id,vlm_caption:String(i)})));
  assert.equal(result.rows[0].vlm_caption,null);
});
test('different image path case cannot silently merge; safe single alias recovers caption', () => {
  let result=reconcile([row],[{...row,dedupe_metadata_filenames:['b']}],[{...row,metadata_filename:'b',image_filename:'b.jpg',external_url:'https://archive.test/image.jpg',vlm_caption:'Wrong'}]);
  assert.equal(result.rows[0].vlm_caption,null); assert.equal(result.aliases.b,undefined);
  result=reconcile([row],[{...row,dedupe_metadata_filenames:['b']}],[{...row,metadata_filename:'b',vlm_caption:'Recovered'}]);
  assert.equal(result.rows[0].vlm_caption,'Recovered');
});
test('embedding text preserves archival descriptions alongside generated observations',()=>{
  const text=buildSearchText({...row,vlm_caption:'Visible tower'});
  for(const part of ['Original evidence','Portal evidence','Visible tower','AI-generated']) assert.ok(text.includes(part));
});
