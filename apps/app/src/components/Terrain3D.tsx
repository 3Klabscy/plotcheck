// Native placeholder: the 3D view uses WebGL (three.js) on the web build; native arrives with the store builds.
import { Text, View } from "react-native";
import type { Parcel } from "@plotcheck/core";

export function Terrain3D(_props: { country: string; parcel: Parcel; onClose(): void }) {
  return (
    <View style={{ padding: 16 }}>
      <Text>3D view is available on the web version.</Text>
    </View>
  );
}
