import React from 'react';
import { Text, View, type TextProps, type ViewProps } from 'react-native';
import { FONT, useTheme } from './theme';

export function Display({ style, children, ...rest }: TextProps) {
  const { t } = useTheme();
  const txt = typeof children === 'string' && t.upper ? children.toUpperCase() : children;
  return (
    <Text {...rest} style={[{ fontFamily: FONT.display, color: t.text, fontStyle: t.display }, style]}>{txt}</Text>
  );
}

export function Body({ style, ...rest }: TextProps) {
  const { t } = useTheme();
  return <Text {...rest} style={[{ fontFamily: FONT.body, color: t.text, fontSize: 14 }, style]} />;
}

export function Card({ style, ...rest }: ViewProps) {
  const { t } = useTheme();
  return (
    <View
      {...rest}
      style={[{ backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.card }, style]}
    />
  );
}
