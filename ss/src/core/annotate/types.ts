export interface Point {
  x: number;
  y: number;
}

export type ShapeTool = 'arrow' | 'rectangle' | 'ellipse' | 'highlight' | 'blur';
export type Tool = ShapeTool | 'text' | 'crop';

export interface ShapeAnnotation {
  kind: 'shape';
  tool: ShapeTool;
  color: string;
  start: Point;
  end: Point;
}

export interface TextAnnotation {
  kind: 'text';
  color: string;
  position: Point;
  text: string;
}

export interface CropAnnotation {
  kind: 'crop';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Annotation = ShapeAnnotation | TextAnnotation | CropAnnotation;

export function isShapeTool(tool: Tool): tool is ShapeTool {
  return (
    tool === 'arrow' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'highlight' ||
    tool === 'blur'
  );
}
