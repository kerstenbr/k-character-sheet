export type Kind = "folder" | "sheet" | "board" | "entry" | "template" | "settings";
export interface Resource {
  id: string;
  kind: Kind;
  name: string;
  parentId: string | null;
  data: any;
  revision: number;
  updated: string;
  deleted: string | null;
}
export interface Field {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: "text" | "check" | "image";
  value: string | boolean;
  assetId?: string;
  imageCleared?: boolean;
  label: string;
  fontSize: number;
  align: "left" | "center" | "right";
  native?: string;
  nativeType?: string;
  options?: string[];
  option?: string;
}
export interface BoardItem {
  id: string;
  type: "note" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  assetId?: string;
}
export interface Connection {
  id: string;
  from: string;
  to: string;
}
export interface BoardData {
  items: BoardItem[];
  connections: Connection[];
}
export interface Settings {
  mode: "auto" | "manual";
  delay: number;
  theme: "dark" | "light" | "system";
}
