// Native (iOS/Android) map arrives with the phase 3 store builds (@maplibre/maplibre-react-native).
// Phase 1 is web only; this placeholder keeps the native bundle compiling.
import { forwardRef, useImperativeHandle } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PlotMapHandle, PlotMapProps } from "./PlotMap.types";

export const PlotMap = forwardRef<PlotMapHandle, PlotMapProps>(function PlotMap(_props, ref) {
  useImperativeHandle(ref, () => ({ flyTo: () => undefined }));
  return (
    <View style={styles.box}>
      <Text>Map is available on the web version in phase 1.</Text>
    </View>
  );
});

const styles = StyleSheet.create({ box: { flex: 1, alignItems: "center", justifyContent: "center" } });
