# Diário de Recuperação 🐾

App web (PWA, sem backend) para a tutora acompanhar em casa uma cadela em recuperação de atropelamento: remédios, água,
comida, respiração (contagem manual e **por áudio**), sinais gerais, alertas e relatório para o veterinário.
**Não substitui o veterinário, não diagnostica e não sugere nem calcula doses.** Todos os dados ficam no celular (IndexedDB);
o áudio é analisado no próprio aparelho e nada vai para a internet.

## Como abrir no celular

O microfone e a instalação como app exigem **HTTPS** (ou `localhost`). Opções:

1. **GitHub Pages** (recomendado): no repositório, *Settings → Pages → Deploy from branch → main / (root)*. Abra o endereço `https://<usuario>.github.io/diario-recuperacao/` no celular.
2. Qualquer hospedagem estática com HTTPS (Netlify Drop, Cloudflare Pages…): basta enviar esta pasta.
3. Só para testar no computador: `npm run serve` e abra `http://localhost:8080`.

> Os dados pertencem ao **endereço** em que o app foi aberto. Use sempre o mesmo endereço e o mesmo navegador, e faça **Exportar backup** de vez em quando (Mais → Dados).

### Adicionar à tela inicial
* **Android (Chrome)**: menu ⋮ → *Instalar app* / *Adicionar à tela inicial*.
* **iPhone (Safari)**: botão Compartilhar → *Adicionar à Tela de Início*. (Notificações só funcionam no iPhone com o app instalado, iOS 16.4+.)

Depois de aberto uma vez, funciona **offline**.

### Avisos de horário
Mais → *Ativar avisos de remédio*. Os navegadores só avisam com o app aberto ou em segundo plano; se bloquearem, o app avisa.
**Use também o alarme do celular** para os horários dos remédios.

## Medição de respiração por áudio
Ambiente silencioso, celular parado a 10–30 cm do focinho/peito. O app desliga eco/ruído/ganho automáticos, mede 3 s de ambiente,
grava 30 ou 60 s, mostra a onda com os picos marcados e o nível de confiança, e **a tutora sempre confirma ou corrige** o valor.
Invalida a medida em caso de latido, ofego, movimento, ruído alto ou sinal fraco. Nas 5 primeiras medições pede a contagem manual para calibrar.
Os limiares de ruído/qualidade são **heurísticas validadas com sinais sintéticos**: use a calibração com a sua cadela e o seu celular
antes de confiar na medida automática; a contagem manual continua sempre disponível.

## Desenvolvimento
```
npm test        # 49 testes: agenda, alertas, DSP de respiração, relatório/CSV
npm run serve   # servidor local
```
Estrutura: `js/schedule.js` (agenda), `js/alerts.js` (alertas), `js/breath.js` (DSP), `js/calc.js`, `js/report.js`, `js/db.js`;
telas em `js/app.js`, `meds.js`, `records.js`, `resp.js`, `more.js`. Modelo de dados: [docs/DADOS.md](docs/DADOS.md).
