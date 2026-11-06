// `@react-x11/components/rich-text-editor`'s declarations name four DOM
// globals through ProseMirror's types, and this project type-checks with
// `skipLibCheck` off and no `"dom"` lib. These are the four, as that package
// ships them (its `src/rich-text-editor/dom-globals.d.ts`). Ambient and
// compile-time only: nothing emitted names them.
interface ShadowRoot {}
interface MutationRecord {}
interface HTMLElementEventMap {}
/** Only ever read as `InstanceType<typeof window.Node>`. */
declare var window: { readonly Node: new () => object };
