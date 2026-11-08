# Site e agenda — Samara F. Krevei

Site institucional para apresentar o método Microderme e agenda profissional protegida por login. A agenda grava dados no PostgreSQL do Supabase por meio do servidor Node; a chave secreta do banco nunca é enviada ao navegador.

## Prévia do site

Abra `visualizar.html` para ver o protótipo com imagens, estilos e animações reunidos em um único arquivo.

## Configurar o Supabase

1. Crie um projeto no Supabase.
2. No painel, abra **SQL Editor**, crie uma consulta, cole o conteúdo de `supabase/schema.sql` e execute. Isso cria as tabelas e ativa Row Level Security sem políticas públicas.
3. Copie o **Project URL** e uma chave **Secret** do projeto. A chave `sb_secret_...` é a opção atual; projetos que ainda exibem as chaves legadas podem usar `service_role`.
4. Configure as variáveis abaixo no serviço do Render. Use `SUPABASE_SECRET_KEY` para a chave atual ou `SUPABASE_SERVICE_ROLE_KEY` para a chave legada.

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SECRET_KEY` | Chave Secret do Supabase; mantenha privada |
| `AGENDA_USERNAME` | `samarafkrevei` |
| `AGENDA_PASSWORD` | Senha escolhida para a esteticista |
| `SESSION_SECRET` | Segredo aleatório com pelo menos 32 caracteres |

Também é possível configurar `SUPABASE_SERVICE_ROLE_KEY` no lugar de `SUPABASE_SECRET_KEY` caso o projeto use a chave legada. Não coloque nenhuma dessas chaves no HTML, no JavaScript do navegador ou no Git. A chave secreta/service role ignora as regras RLS do Supabase; por isso, este pacote só a usa no servidor, e as rotas da agenda exigem sessão autenticada.

Para desenvolvimento local, copie `.env.example` para `.env`, preencha as variáveis e inicie com Node.js 22 ou superior:

```bash
npm install
npm start
```

Depois abra `http://localhost:4174`. O `.gitignore` exclui `.env`.

## Publicar no Render

Use o mesmo repositório Git em um **Web Service**. Na raiz do projeto, configure o comando de build `npm install` e o comando de início `npm start`; adicione as variáveis da tabela como Environment Variables privadas. A agenda pode continuar no mesmo repositório do site, sem precisar criar outro. Como os dados ficam no Supabase, não é necessário adicionar disco persistente ao Render.

Não publique a agenda como Static Site: o login e o acesso protegido ao banco dependem do servidor Node. O site público pode ser servido pelo mesmo Web Service.

## Recursos da agenda

- Login protegido por sessão HTTP-only.
- Cadastro e pesquisa de clientes, com edição e atalho para WhatsApp.
- Calendário com horários, bloqueio de fins de semana e feriados nacionais configurados no código.
- Financeiro com consultas futuras, parcelas previstas e totais mensais.
- Endereço e chave Pix configuráveis dentro da agenda.

Ao salvar uma consulta, o navegador abre uma conversa do WhatsApp com a confirmação preenchida para revisão e envio. Isso não envia a mensagem automaticamente; o envio sem intervenção requer integração com a API oficial do WhatsApp Business.

## Site público

Para trabalhar apenas na página institucional, mantenha `index.html`, `styles.css`, `script.js` e `assets/` juntos. Para visualizar localmente:

```bash
python -m http.server 4173
```

Abra `http://localhost:4173`.
