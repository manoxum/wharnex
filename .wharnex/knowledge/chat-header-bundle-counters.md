# Cabeçalho do chat e contadores de bundles

No `BundleExchangeBar` do cabeçalho do chat, não repetir total, enviados/recebidos nem a quota móvel global quando essas métricas já têm superfícies próprias. O strip deve ficar focado nos cards recentes de request/response; qualquer card continua a abrir o `BundleExplorer`, cuja lista contém todos os bundles válidos da sessão.

A quota global permanece no `WorkspaceTopbar` ou, no layout embedded, na command bar do Agent; as contagens agregadas continuam na área Ficheiros. Ao simplificar o header, remover também o polling de `api.bundleQuota()` e os estilos/testes exclusivos do resumo para não deixar tráfego periódico ou CSS morto.
