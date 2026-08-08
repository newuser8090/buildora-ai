// ---------------------------------------------------------------------------
// useDomains — custom domain orchestration (Phase P8)
//
// Wires the DomainService to the active project. The provider adapter must
// declare customDomains capability AND expose a DomainProviderClient
// (Vercel does). Domains are local product history; the provider is the
// remote source of truth. Never touches ProjectSchema.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getDeploymentAdapter } from "../storage/deployment-adapter";
import { getDomainAdapter } from "../domain/domain-storage";
import { DomainService } from "../domain/domain-service";
import { getPublishingProvider } from "../providers";
import type { DomainProviderClient } from "../domain/types";
import type { DeploymentDomainRecord } from "../domain/types";
import type { PublishError } from "../errors";

export type DomainActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublishError };

export function useDomains() {
  const project = useEditorStore((s) => s.project);
  const [domains, setDomains] = useState<DeploymentDomainRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(false);

  const provider = useMemo(() => getPublishingProvider("vercel"), []);
  const domainClient = useMemo<DomainProviderClient | null>(() => {
    if (!provider) return null;
    const client = (provider as unknown as { domains?: DomainProviderClient }).domains;
    return client ?? null;
  }, [provider]);

  // The domains client exists statically on the provider, but domain features
  // only make sense when the provider is actually configured/available here.
  useEffect(() => {
    if (!provider) return;
    let active = true;
    void (async () => {
      try {
        const availability = await provider.isAvailable();
        if (active) setProviderAvailable(availability.available);
      } catch {
        if (active) setProviderAvailable(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [provider]);

  const supportsDomains = useMemo(
    () => !!domainClient && !!provider?.capabilities.customDomains && providerAvailable,
    [domainClient, provider, providerAvailable],
  );

  const service = useMemo(() => {
    if (!domainClient) return null;
    return new DomainService({
      storage: getDomainAdapter(),
      deployments: getDeploymentAdapter(),
      provider: domainClient,
      providerId: "vercel",
    });
  }, [domainClient]);

  const refresh = useCallback(async () => {
    if (!project.id || !service) return;
    setLoading(true);
    try {
      const list = await service.listDomains(project.id);
      setDomains(list);
    } catch {
      // Local domain cache is optional product history — the provider is the
      // source of truth. A missing/unavailable local store must never break
      // the publish UI (e.g. environments without IndexedDB).
      setDomains([]);
    } finally {
      setLoading(false);
    }
  }, [project.id, service]);

  // Refresh when the project changes — only when the provider actually
  // supports custom domains here and now.
  useEffect(() => {
    if (!project.id || !supportsDomains || !service) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const list = await service.listDomains(project.id);
        if (!cancelled) setDomains(list);
      } catch {
        if (!cancelled) setDomains([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, supportsDomains, service]);

  const attach = useCallback(
    async (input: string): Promise<DomainActionResult<DeploymentDomainRecord>> => {
      if (!service) {
        return { ok: false, error: { code: "DOMAIN_ATTACH_FAILED", message: "Custom domains aren't available for this publishing option." } };
      }
      const result = await service.attach(project.id, input);
      if (result.ok) await refresh();
      return result;
    },
    [service, project.id, refresh],
  );

  const refreshStatus = useCallback(
    async (record: DeploymentDomainRecord): Promise<DomainActionResult<DeploymentDomainRecord>> => {
      if (!service) return { ok: false, error: { code: "DOMAIN_VERIFICATION_FAILED", message: "Custom domains aren't available for this publishing option." } };
      const result = await service.refreshStatus(record);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  const remove = useCallback(
    async (record: DeploymentDomainRecord): Promise<DomainActionResult<void>> => {
      if (!service) return { ok: false, error: { code: "DOMAIN_ATTACH_FAILED", message: "Custom domains aren't available for this publishing option." } };
      const result = await service.remove(record);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  const primaryDomain = useMemo(
    () => domains.find((d) => d.status === "verified" && d.primary) ?? null,
    [domains],
  );

  return {
    domains,
    loading,
    supportsDomains,
    primaryDomain,
    refresh,
    attach,
    refreshStatus,
    remove,
  };
}
