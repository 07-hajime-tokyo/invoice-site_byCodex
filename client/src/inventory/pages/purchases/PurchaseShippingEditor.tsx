import { Input } from "@/components/ui/input";
import { Truck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CARRIER_OPTIONS } from "./constants";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseShippingEditor({
  editState,
  setEditState,
}: Pick<PurchasePageModel, "editState" | "setEditState">) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          <Truck className="h-3.5 w-3.5 inline mr-1" />
          仕入先発送日
        </label>
        <Input
          type="date"
          value={editState.shipDate}
          onChange={e =>
            setEditState(s => ({
              ...s,
              shipDate: e.target.value,
            }))
          }
          className="h-8 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          追跡番号
        </label>
        <Input
          type="text"
          placeholder="追跡番号を入力"
          value={editState.trackingNumber}
          onChange={e =>
            setEditState(s => ({
              ...s,
              trackingNumber: e.target.value,
            }))
          }
          className="h-8 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          配送業者
        </label>
        <Select
          value={editState.carrier}
          onValueChange={v => setEditState(s => ({ ...s, carrier: v }))}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="自動判別" />
          </SelectTrigger>
          <SelectContent>
            {CARRIER_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          備考
        </label>
        <Input
          type="text"
          placeholder="備考を入力"
          value={editState.note}
          onChange={e =>
            setEditState(s => ({
              ...s,
              note: e.target.value,
            }))
          }
          className="h-8 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          仕入先名
        </label>
        <Input
          type="text"
          placeholder="例: 駿河屋 盛岡MOSSビル店"
          value={editState.supplierName}
          onChange={e =>
            setEditState(s => ({
              ...s,
              supplierName: e.target.value,
            }))
          }
          className="h-8 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          仕入先URL
        </label>
        <Input
          type="text"
          placeholder="https://example.com/item"
          value={editState.supplierUrl}
          onChange={e =>
            setEditState(s => ({
              ...s,
              supplierUrl: e.target.value,
            }))
          }
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
