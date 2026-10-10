/** react-native-svg for React interaction tests: `Svg`, its shapes and gradients render as host
 *  elements named after themselves, carrying their props, so a test reads what would be drawn. */
import React from 'react';

type HostProps = { children?: React.ReactNode; [key: string]: unknown };
const host = (name: string) => (props: HostProps) => React.createElement(name, props, props.children);

const Svg = host('Svg');
export default Svg;
export const Path = host('Path');
export const Circle = host('Circle');
export const Rect = host('Rect');
export const Defs = host('Defs');
export const RadialGradient = host('RadialGradient');
export const LinearGradient = host('LinearGradient');
export const Stop = host('Stop');
