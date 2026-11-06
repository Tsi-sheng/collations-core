import {fromMarkdown} from 'mdast-util-from-markdown'
import {gfm} from 'micromark-extension-gfm'
import {gfmFromMarkdown} from 'mdast-util-gfm'
import {math} from 'micromark-extension-math'
import {mathFromMarkdown} from 'mdast-util-math'

/** Preview extensions apply only to this parse; the index keeps its existing contract. */
export function parsePreview(source:string) {
  return fromMarkdown(source,{extensions:[gfm(),math()],mdastExtensions:[gfmFromMarkdown(),mathFromMarkdown()]})
}
