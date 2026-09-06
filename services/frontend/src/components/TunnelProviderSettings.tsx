import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TunnelProvider, TunnelProviderInstance } from "../types";
import { Icon } from "./Icon";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function TunnelProviderSettings({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [instances, setInstances] = useState<TunnelProviderInstance[]>();
  const [instanceName, setInstanceName] = useState("");
  const [providers, setProviders] = useState<TunnelProvider[]>();
  const [runtime, setRuntime] = useState<
    Record<string, { available: boolean; error?: string }>
  >({});
  const [showCatalog, setShowCatalog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connecting, setConnecting] = useState<number>();
  const [draftFields, setDraftFields] = useState<
    Record<number, Record<string, string>>
  >({});

  useEffect(() => {
    let alive = true;
    Promise.all([api.tunnelConfig(), api.tunnelProviders(), api.config()])
      .then(([stored, catalog, appConfig]) => {
        if (!alive) return;
        setInstances(stored.config.instances || []);
        setInstanceName(stored.config.instance_name || "");
        setProviders(catalog.providers || []);
        setSaved(stored.restart_required);
        setRuntime(
          Object.fromEntries(
            (appConfig.remote_input?.instances || []).map((item) => [
              item.id,
              { available: item.available, error: item.error },
            ]),
          ),
        );
      })
      .catch((error) => {
        if (alive)
          onError(
            messageOf(error, "Não foi possível carregar os providers de túnel"),
          );
      });
    return () => {
      alive = false;
    };
  }, [onError]);

  function add(provider: TunnelProvider) {
    setSaved(false);
    setShowCatalog(false);
    setInstances((current) => {
      const values = current || [];
      const used = new Set(values.map(({ id }) => id));
      let suffix = 1;
      while (used.has(`${provider.id}-${suffix}`)) suffix++;
      return [
        ...values,
        {
          id: `${provider.id}-${suffix}`,
          provider: provider.id,
          priority: (values.length + 1) * 10,
        },
      ];
    });
  }

  function update(index: number, patch: Partial<TunnelProviderInstance>) {
    setSaved(false);
    setInstances((current) =>
      current?.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setSaved(false);
    setInstances((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [
        reordered[target],
        reordered[index],
      ];
      return reordered.map((item, itemIndex) => ({
        ...item,
        priority: (itemIndex + 1) * 10,
      }));
    });
  }

  async function save() {
    if (!instances || saving) return;
    if (!instanceName.trim())
      return onError("Dê um nome a esta instância Wharness antes de guardar.");
    const ids = new Set<string>();
    for (const instance of instances) {
      if (!ID_PATTERN.test(instance.id))
        return onError(
          `O identificador “${instance.id || "(vazio)"}” é inválido.`,
        );
      if (ids.has(instance.id))
        return onError(`O identificador “${instance.id}” está repetido.`);
      if (
        ![
          "trycloudflare",
          "zrok",
          "localxpose",
          "localhost_run",
          "pinggy",
          "serveo",
          "tailscale_funnel",
        ].includes(instance.provider) &&
        !instance.credential_ref
      )
        return onError(
          `Ligue a conta da instância “${instance.id}” antes de guardar.`,
        );
      if (
        instance.provider === "tailscale_funnel" &&
        (!instance.public_url || !instance.local_port)
      )
        return onError(
          `Indique a URL .ts.net e a porta local da instância “${instance.id}”.`,
        );
      ids.add(instance.id);
    }
    setSaving(true);
    try {
      const result = await api.updateTunnelConfig({
        version: 1,
        instance_name: instanceName.trim(),
        instances: instances.map((item) => ({ ...item, id: item.id.trim() })),
      });
      setInstanceName(result.config.instance_name || "");
      setInstances(result.config.instances);
      setSaved(result.restart_required);
    } catch (error) {
      onError(
        messageOf(error, "Não foi possível guardar os providers de túnel"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function connect(index: number, provider: TunnelProvider) {
    const instance = instances?.[index];
    if (!instance || connecting !== undefined) return;
    if (!ID_PATTERN.test(instance.id))
      return onError("Defina primeiro um nome de instância válido.");
    setConnecting(index);
    try {
      const enrollment = await api.connectTunnelProvider(
        instance.id,
        provider.id,
        draftFields[index] || {},
      );
      update(index, {
        credential_ref: enrollment.credential_ref,
        public_url: enrollment.public_url,
        local_port: enrollment.local_port,
      });
    } catch (error) {
      onError(messageOf(error, "Não foi possível ligar a conta do provider"));
    } finally {
      setConnecting(undefined);
    }
  }

  async function remove(index: number) {
    const instance = instances?.[index];
    if (!instance) return;
    try {
      if (instance.credential_ref)
        await api.disconnectTunnelProvider(instance.credential_ref);
      setSaved(false);
      setInstances((current) =>
        current?.filter((_, itemIndex) => itemIndex !== index),
      );
    } catch (error) {
      onError(
        messageOf(error, "Não foi possível remover a credencial do túnel"),
      );
    }
  }

  if (!instances || !providers)
    return (
      <div className="settings-loading compact">
        <span className="settings-spinner" />A carregar providers de túnel…
      </div>
    );

  return (
    <section className="remote-storage-settings tunnel-provider-settings">
      <div className="remote-storage-hero">
        <div className="remote-storage-glyph">
          <Icon name="network" size={22} />
        </div>
        <div>
          <span className="eyebrow">Transporte para o ChatGPT</span>
          <h3>Túneis de verificação</h3>
          <p>
            Todos os túneis configurados são publicados por pedido e
            apresentados ao ChatGPT pela prioridade. O bundle ZIP é controlado
            separadamente no composer.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setShowCatalog((value) => !value)}
        >
          <Icon name={showCatalog ? "close" : "plus"} size={14} />
          {showCatalog ? "Fechar catálogo" : "Adicionar provider"}
        </button>
      </div>
      <div className="remote-storage-retention">
        <Icon name="shield" size={15} />
        <span>
          Providers permanentes preservam o mesmo DNS após reinícios e reidratam
          requests em curso. Cada request mantém um namespace secreto e isolado.
        </span>
      </div>
      <label className="tunnel-instance-identity">
        <span>Nome desta instância Wharness</span>
        <input
          value={instanceName}
          maxLength={80}
          placeholder="Ex.: Oficina da Ana"
          onChange={(event) => {
            setSaved(false);
            setInstanceName(event.target.value);
          }}
        />
        <small>
          É apresentado na landing page e no QR de descoberta. Não use dados
          sensíveis.
        </small>
      </label>
      {saved ? (
        <div className="remote-storage-restart" role="status">
          <span />
          <div>
            <strong>Configuração guardada</strong>
            <small>
              Reinicie o Wharness para ativar o novo provider de túnel.
            </small>
          </div>
        </div>
      ) : null}
      {showCatalog ? (
        <section
          className="provider-catalog"
          aria-label="Providers de túnel disponíveis"
        >
          <header>
            <div>
              <strong>Escolha um provider de túnel</strong>
              <span>O catálogo não inclui drivers de armazenamento.</span>
            </div>
          </header>
          <div>
            {providers.map((provider) => (
              <button
                key={provider.id}
                disabled={!provider.available}
                onClick={() => add(provider)}
              >
                <span className={`provider-mark provider-${provider.id}`}>
                  {providerMark(provider.id)}
                </span>
                <span>
                  <strong>
                    {provider.name}
                    {provider.permanent_dns
                      ? " · DNS permanente"
                      : " · temporário"}
                  </strong>
                  <small>{provider.description}</small>
                </span>
                <Icon name="chevron" size={14} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <div className="remote-instance-list">
        {instances.length === 0 ? (
          <div className="remote-storage-empty">
            <Icon name="file" size={26} />
            <strong>Transporte direto por ficheiros</strong>
            <span>
              Nenhum túnel configurado. O bundle ZIP continua disponível quando
              estiver ativo no composer.
            </span>
          </div>
        ) : null}
        {instances.map((instance, index) => {
          const provider = providers.find(({ id }) => id === instance.provider);
          const localReady =
            provider?.auth_mode === "local" &&
            (provider.fields.length === 0 ||
              Boolean(instance.public_url && instance.local_port));
          const connected =
            provider?.auth_mode === "none" ||
            localReady ||
            Boolean(instance.credential_ref);
          const health = runtime[instance.id];
          const unavailable = health?.available === false;
          return (
            <article
              className="remote-instance-card"
              key={`${instance.id}-${index}`}
            >
              <header>
                <div className={`provider-mark provider-${instance.provider}`}>
                  {providerMark(instance.provider)}
                </div>
                <div>
                  <strong>{provider?.name || instance.provider}</strong>
                  <span>
                    {instance.id} · prioridade {index + 1}
                  </span>
                </div>
                <span
                  className={`connection-state ${connected && !unavailable ? "connected" : ""}`}
                >
                  <i />
                  {unavailable
                    ? "Indisponível"
                    : connected
                      ? provider?.permanent_dns
                        ? "DNS permanente"
                        : "Temporário"
                      : "Configuração pendente"}
                </span>
                <div className="remote-instance-actions">
                  <button
                    className="icon-button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    title="Subir na prioridade"
                  >
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={index === instances.length - 1}
                    onClick={() => move(index, 1)}
                    title="Descer na prioridade"
                  >
                    <Icon name="arrow-down" size={14} />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => void remove(index)}
                    title="Remover instância"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </header>
              {unavailable ? (
                <div className="remote-storage-restart" role="alert">
                  <span />
                  <div>
                    <strong>O provider não está ativo nesta instalação</strong>
                    <small>
                      {health.error ||
                        "Instale e autentique o cliente standalone antes de reiniciar o Wharness."}
                    </small>
                  </div>
                </div>
              ) : null}
              <div className="remote-instance-grid identity">
                <label>
                  <span>Nome da instância</span>
                  <input
                    value={instance.id}
                    onChange={(event) =>
                      update(index, { id: event.target.value })
                    }
                  />
                </label>
                {instance.public_url && provider?.auth_mode !== "local" ? (
                  <label>
                    <span>URL pública permanente</span>
                    <input readOnly value={instance.public_url} />
                  </label>
                ) : null}
              </div>
              {provider?.auth_mode === "local" ? (
                <div className="remote-instance-grid">
                  {provider.fields.map((field) => (
                    <label key={field.id}>
                      <span>{field.label}</span>
                      <input
                        type={field.id === "local_port" ? "number" : "text"}
                        placeholder={field.placeholder}
                        value={
                          field.id === "local_port"
                            ? String(instance.local_port || "")
                            : instance.public_url || ""
                        }
                        onChange={(event) =>
                          update(
                            index,
                            field.id === "local_port"
                              ? {
                                  local_port: Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                }
                              : { public_url: event.target.value },
                          )
                        }
                      />
                    </label>
                  ))}
                  <div>
                    <strong>Autenticação standalone</strong>
                    <small>
                      O Wharness reutiliza a sessão local do cliente e não
                      guarda credenciais desta conta.
                    </small>
                    {provider.auth_url ? (
                      <a
                        className="secondary-button"
                        href={provider.auth_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="external" size={14} />
                        Abrir autenticação no navegador
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {provider?.auth_mode === "token" && !connected ? (
                <div className="remote-instance-grid">
                  {provider.auth_url ? (
                    <a
                      className="secondary-button"
                      href={provider.auth_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="external" size={14} />
                      Abrir conta no navegador
                    </a>
                  ) : null}
                  {provider.fields.map((field) => (
                    <label key={field.id}>
                      <span>{field.label}</span>
                      <input
                        type={
                          field.secret
                            ? "password"
                            : field.id === "local_port"
                              ? "number"
                              : "text"
                        }
                        placeholder={field.placeholder}
                        value={draftFields[index]?.[field.id] || ""}
                        onChange={(event) =>
                          setDraftFields((current) => ({
                            ...current,
                            [index]: {
                              ...(current[index] || {}),
                              [field.id]: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                  <button
                    className="secondary-button"
                    disabled={connecting !== undefined}
                    onClick={() => void connect(index, provider)}
                  >
                    <Icon name="network" size={14} />
                    {connecting === index ? "A ligar…" : "Ligar conta e DNS"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="remote-storage-actions">
        <span>
          {instances.length}{" "}
          {instances.length === 1 ? "túnel configurado" : "túneis configurados"}
        </span>
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => void save()}
        >
          <Icon name="save" size={14} />
          {saving ? "A guardar…" : "Guardar configuração"}
        </button>
      </div>
    </section>
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function providerMark(provider: string) {
  return (
    (
      {
        cloudflare_named: "CF",
        trycloudflare: "CF",
        ngrok: "NG",
        zrok: "ZR",
        tailscale_funnel: "TS",
        localxpose: "LX",
        localhost_run: "SSH",
        pinggy: "PG",
        serveo: "SV",
      } as Record<string, string>
    )[provider] || "TN"
  );
}
