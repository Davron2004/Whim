/** react-native-svg for React interaction tests: `Svg` and `Path` render as host elements named after
 *  themselves, carrying their props, so a test reads what would be drawn. */
import React from 'react';

type HostProps = { children?: React.ReactNode; [key: string]: unknown };
const host = (name: string) => (props: HostProps) => React.createElement(name, props, props.children);

const Svg = host('Svg');
export default Svg;
export const Path = host('Path');
