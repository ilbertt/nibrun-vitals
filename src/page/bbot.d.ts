// The face library ships no types; this is the slice of its API the page uses.
declare module '@bwnd/bbot' {
  export type Face = {
    setExpression(name: string): void;
    react(name: string): void;
  };
  export type FaceOptions = {
    expression?: string;
    mouth?: boolean;
    pupils?: boolean;
    track?: boolean;
    blink?: boolean;
    idle?: boolean;
  };
  export function createFace(el: Element, opts?: FaceOptions): Face;
  export const EXPRESSION_NAMES: readonly string[];
  export const REACTION_NAMES: readonly string[];
}

// `with { type: "file" }` imports resolve to the URL the bundler emitted the file at.
declare module '*.woff2' {
  const url: string;
  export default url;
}
