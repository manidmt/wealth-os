import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AgentMessage = { id: string; role: "user" | "assistant"; content: string };

export function useAgentMessages() {
  const { user } = useAuth();
  return useQuery<AgentMessage[]>({
    queryKey: ["agent_messages", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("agent_messages")
        .select("id, role, content, created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((m: any) => ({ id: m.id, role: m.role, content: m.content }));
    },
    enabled: !!user,
    staleTime: 10_000,
  });
}
