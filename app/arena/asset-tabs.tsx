"use client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Asset } from "@/lib/api-types";

export function AssetTabs({ asset, onChange }: { asset: Asset; onChange: (asset: Asset) => void }) {
  return (
    <Tabs value={asset} onValueChange={(v) => onChange(v as Asset)}>
      <TabsList className="mode-tabs" style={{ maxWidth: 340, margin: "15px 0" }}>
        <TabsTrigger value="gems">Gems</TabsTrigger>
        <TabsTrigger value="devnet">Devnet SOL</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
