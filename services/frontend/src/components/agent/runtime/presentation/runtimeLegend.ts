export type OperationalState = 'idle' | 'writing' | 'listening' | 'waiting' | 'chat-empty' | 'working' | 'loading' | 'error' | 'stopped' | 'draining' | 'paused'



// One entry per colour the list can show. A running task can be in several
// of them (preparing, sending, waiting for ChatGPT), so each entry names the
// phases it covers rather than the durable task status.
export const stateLegend: { key: OperationalState; label: string; hint: string }[] = [
  { key: 'idle', label: 'Ocioso', hint: 'Sem tarefa' },
  { key: 'waiting', label: 'Na fila / a aguardar', hint: 'Na fila de envio do ritmo global, tarefa em espera, ou Worker preso à sua tarefa entre rondas' },
  { key: 'loading', label: 'A abrir conversa', hint: 'A navegar ou a carregar a página do ChatGPT' },
  { key: 'working', label: 'A preparar / validar', hint: 'A iniciar, a preparar o pedido, a descarregar ou a validar a resposta' },
  { key: 'writing', label: 'A enviar ao GPT', hint: 'A carregar o ZIP, a submeter ou a escrever no chat' },
  { key: 'listening', label: 'GPT a processar', hint: 'Pedido submetido; o ChatGPT está a gerar a resposta' },
  { key: 'chat-empty', label: 'Chat sem jobs', hint: 'Supervisor com chat mas sem trabalho' },
  { key: 'paused', label: 'Suspenso', hint: 'Workers suspensos pela política' },
  { key: 'error', label: 'Com erro', hint: 'A última tentativa falhou' },
  { key: 'stopped', label: 'Parado', hint: 'Loop do agente parado' },
  { key: 'draining', label: 'A terminar', hint: 'A sair do pool após reduzir o número de agentes' },
]
