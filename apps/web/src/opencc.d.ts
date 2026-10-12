declare module "opencc-js/cn2t" {
  export function Converter(options: {
    from: "cn";
    to: "tw";
  }): (text: string) => string;
}
