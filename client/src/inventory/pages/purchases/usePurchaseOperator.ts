import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

export function usePurchaseOperator() {
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const [selectedOperatorKey, setSelectedOperatorKey] = useState<string>(
    () => localStorage.getItem("zaico_operator_key") ?? "default"
  );
  function handleOperatorChange(key: string) {
    setSelectedOperatorKey(key);
    localStorage.setItem("zaico_operator_key", key);
  }
  useEffect(() => {
    if (!operators || !currentUser?.email) return;
    const matched = operators.find(
      op =>
        op.email && op.email.toLowerCase() === currentUser.email!.toLowerCase()
    );
    if (matched) {
      setSelectedOperatorKey(matched.key);
      localStorage.setItem("zaico_operator_key", matched.key);
    }
  }, [operators, currentUser?.email]);
  const selectedOperatorName =
    operators?.find(o => o.key === selectedOperatorKey)?.name ?? "野田";
  return {
    operators,
    selectedOperatorKey,
    handleOperatorChange,
    selectedOperatorName,
  };
}
