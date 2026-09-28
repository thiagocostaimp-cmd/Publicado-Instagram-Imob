// Seu Lugar Publicador -- portado de um Claude Artifact para este backend.
// A montagem das imagens (canvas) é idêntica ao original; o que mudou é só a
// "cola" com o mundo de fora:
//   - banco de dados do Artifact   -> API deste backend (Store, abaixo)
//   - armazenamento de imagens     -> upload direto (sem assinatura) pro Cloudinary
//   - IA para extrair dados        -> POST /api/publicador/extrair-ia (API da Anthropic no backend)
// A leitura automática do link do anúncio e a publicação automática no
// Instagram (que usavam conectores só disponíveis dentro do claude.ai) ficam
// de fora por enquanto -- ver README.
(function () {
"use strict";

/* ============================================================
   API helper (mesma convenção do app.js do painel principal)
   ============================================================ */
async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* resposta vazia -- ok */ }
  if (!res.ok) {
    const err = new Error(data.error || `Erro (status ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ============================================================
   CONSTANTS & DEFAULTS
   ============================================================ */
const DEFAULT_CONFIG = {
  nome_marca: "Seu Lugar",
  slogan: "Imobiliária Descomplicada",
  cidade_estado: "LAVRAS/MG",
  cor_vermelho: "#9e0000",
  cor_preto: "#000000",
  cor_branco: "#ffffff",
  legenda_template: "🏠 Locação: {tipo_imovel} no {bairro}\n\n🔑 Código do Imóvel: {codigo_unico}\n\n🛏️ {numero_quartos} {quartos_label} | 🚿 {numero_banheiros} {banheiros_label} | 🚗 {numero_vagas} {vagas_label} | 📐 {metragem}m²\n\n💰 Preço de Locação R${valor_aluguel}/mês\n💰 Condomínio: R${valor_condominio}/mês\n💰 IPTU R${valor_iptu}\n\n✨ Benefícios Exclusivos:\n✅ Seguro Fiança e Incêndio\n✅ Cobertura de IPTU\n✅ Cobertura contra incêndio, vendaval, danos elétricos;\n\n📲 Comente \"Alugar\" ou chame no direct para saber mais!",
  pool_hashtags: ["#SeuLugar","#SemFiador","#AluguelDigital","#LavrasMG","#12Horas","#Autonomia","#ImobiliariaDigital","#Agilidade","#MudancaRapida","#Lavras","#AtendimentoHumanizado","#SeguroFianca","#LocacaoSemFiador"],
  max_hashtags_por_post: 15,
  cta_final: "Comente \"Alugar\"",
  instagram_username: "",
  cloudinary_cloud_name: "",
  cloudinary_upload_preset: "",
  // Logo da marca (opcional). Quando preenchido, a capa desenha essa imagem
  // dentro da caixinha branca em vez do nome da marca escrito em texto.
  logo_url: ""
};

const TIPOS_IMOVEL = ["Apartamento","Casa","Kitnet","Sobrado","Casa de Condomínio","Sala Comercial","Loja","Terreno"];
const TIPO_ABREVIADO = {
  "Apartamento":"APTO", "Casa":"CASA", "Kitnet":"KITNET", "Sobrado":"SOBRADO",
  "Casa de Condomínio":"CASA COND.", "Sala Comercial":"SALA COM.", "Loja":"LOJA", "Terreno":"TERRENO"
};
const LABEL_QUARTOS = "quartos", LABEL_BANHEIROS = "banheiros", LABEL_VAGAS = "vagas", LABEL_COZINHAS = "cozinha";
const DIM_FEED = {w:1080,h:1350};
const DIM_STORY = {w:1080,h:1920};
// Ícones das especificações (quartos/banheiros/vagas/cozinha/área), no mesmo
// visual do template Canva da agência -- glifo branco recolorido do preto
// original via drawTintedIcon (composite "source-in").
const ICON_SRC = {
  bed: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAACbCAMAAAAQnCT1AAACVVBMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADC5MCAAAAxnRSTlMAYBjMImaqVUTQktTnc92Z/QEQ8Bb8BL/CMf7xE/YDVPjoQA77YkpRDd+MKh/33K8nLIWe4TQdBgguXCQKkHviHuwJVo71k9bbvFo74BzlJrFeJc/eBYthqDYM2gtT4zOI80MtuLfvAhSpikbrcY01cm85R119hmftKWxN8g+0dleaPYCkQq7SlNe9WzyjZYmtUBL6F1+igyHGZAcrtvkboWirL7WW2bqBxM6PS6yHGqCVRZxqI8HqOsrIsEHTUihYMNgyfsvd+CyEAAAEBElEQVR42u3WVVcbaxTG8acUTs+hFBKCJCS4t7hD3d3d3d2Ou7u7u7u79/lcXaTQJDMZYVYnzDtr/+/23f5d7LU2JEmyU0VN19tbZq4thNoFH9vFeG/OVJoy0M6rrdoPZesvZVKHIlC1TUxpSRPUbGuAqS2Amn1BTQtjULG+Ymq7Cyq2mbqWQsW+pq6F/VCwT6nvdSjYLuqrgYKVU18lFIxpesEvkAl+hszZvW/rugrFIUW3HghxuNZXZq1TFzKnu4qJAu/3qgkpudjK1Mq6axWEZH1CfRsiykE6mpmu248rBulbwfSV1ygFaVpMo6IdKkGO0rjJM9SBzKdZTykD2ZFHs+o6VYHMonkPKgKZN5fmlU1TA7KWVi1SA7KUVt1cogLk2Tpa9gBGa8quRcYrWv7M8iJLyE5a9yXiFX68hOSGrtjIeN016/6CPTc9/hrSFVwWDpAMhJcFzSGbaF0phmuo5pVONGK4LF7bytc0VkDbytLEFitNIR/RukMAsPM5jlY8ZApx3iONSK2ljYlWTDeDtNFGhcAPe5moatAdCPnuHUhqxodMbvsOE0grbbQf+JHJ/eIWhItbkOgDpvaNMaSEdjqHXqb2u1sQ5r+F0aYHmFpZhyFkG+20D91M7ahrEK6fh5FyqS3XELKRdvoZPUztRNA1CKfiSiUhaouWGEFQRRsN9lHbX+5B6t5DvF7qO20IaaaNYjXU1uAehGsQ7yT1nTGEPErroviT2i64ANH82/dQ33eGkAW0Lox6ajsbh7h6JU9TX7sh5G5adww51DbFTchsDFdKfWFDyJFiWnY+0xDeAgATqe8GQwjCtCrUn3FIvQPIk7SqABmHLHIA2RaiRZHMQ+50AMFLNO8gMg9Z7wRSOJdmBXaPA6TNCQT1NOthjANklSNI8A0al187HpA8RxDEmmlUeQQKQbC6mukrroRSEETymK6qSigGwcsPUV/1vVAOgoHPiqmpvQgKQoDO3wJM6tdvATUhQPb/l+oY799TpwGVILoG/js/qeFcLQAVIfqUhQQ7P6/PMekJNSBFU3tokRKQV0OkHyD3kb6AzKc/IFlRn0C66A9IsNonkEH6BDLkF8hJOuysxyBn6LAhj0Eu0GHHPQb5h84qO+IxyOGf6Kg/4DEI9tBRUzwH+WovHRSKeQ6CCXTQ9/AeBDdyzG057EUI3olybL24EZ6E4PlTPbTfxErAk5B40xo259jqttUYqSLbvVocQLyZQNSGHLve0203gKiXQAQiEIEIRCACEYhABCIQgQhEIAIRiEAEIhCBCGTskNmTPN1B25DJ8HS5AhGIQAQiEIEIRCACEYhABCIQgQhEIAIRiEAEIhCBCEQgAvETJD9NB+Dp/i7Qd/EyEbZzUehLrRsAAAAASUVORK5CYII=",
  toilet: "data:image/png;base64,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",
  car: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAACfCAMAAACLDWbjAAAC2VBMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABbTW0VAAAA8nRSTlMAZhG7Iqqid+/J3cwBBTbumRD++AIIiPr52hax6Ovx9BRE7fevVdUD6QssNQzyD7S5/OL2f6hGt5hkJgbzoDjwHF9pdhmOQPvBIeNIKU1SmoAo0tx6W8sHbpJ434Igh04VbMcSMKWFCfW1JTcEGM4KLjOfHmFCR+xrcNdWo4QNMXS8nTvgfnO2l1k6G8DKq89tU5bZuli/PUwtWtQkDm+nK14T5J6NgVTNhmeLkHtcwyPIio+UvTzhHcJg5mUnrVDbF6xPnMWmNJs5H7iJ0eVJV6STSnxiS9ihQ77nqa5RMkFqstZ5xtB9aIwqL/3q3mORchq0N/IAAAb/SURBVHja7dtlV1vpGsbxC0IohQQo7tqD0yItUKRosXo7dXd3nbq769Rdxu2Mu/uc8Znj7n59gqEDWV1PmsAm2fvZE9b+vUzy5p+1kuz7ubOhnoWLsurXP9Tt5sPBs3qauo/wb5ESFBSUQJKhQS2aWx6JDji12/z2uIjxY6u/WdCUgx8R6/zk/978rvHbFLogtfl27P/+fys7Cbqqe62P+Vwk1RB/YM/a/mOgg8yj256jyiKn31wQBpnSk31zqY1438FjIMnpPWuopcp3v0yH5npNS6P2rm2sg6amTs6lHKFD50MzFz5OpDwNX3hDE5bHXqJc8SuhgaRiyrchE2rrX0A9nGuCulaHUh/NT0BNPy+kXr71hnrOJFKpkKDm6IA7fmFqMc98x1Bzm92mxoAAf/8MP3ZCX6imLI3ORTZ3jy0ZVnPyreTsyz7e4VBm06Lzy+qHPPTo0755abls30CopZvjgoPbagefiYH7Nv1j8JahjZV0YjRUMiaO9wgYti8c6rLM31vyOh3ZB3U8RnuHZkIjrwwr4D02QB3daedlaKhsbS7thCZBDYG0EwttBebTTi3U4Es7V6CxebTjHwb3JYVStCYTGqunvZ/BfRdppw80t5V23oT7FlM0Nwmayw6hKCoJ7sqinUcgkPQpOQJ3DaAo8kNI8NsQim7DTdYMinwhRU/aWQr3vEVRSBak2BxC0Q2V35lYSNKbogwr3HE1iqLtkGQB7UyBO+6nqBHS5FH0KtxxmKJvIM12iqKmqvgjMsICeZ6haCxcN5miUZConqKDcJllBwUFCyHTCxQNh6uepeg+SDWQoo1wVQkFoTGQawQFOyxwjXUNBRWQzIui03DNFIqyIdmceAqC4Zq+FDwJ6WZT4BcOV2yaS0E/SLc/koKjcEU1BYW9IN8hCnrCFSco+A46KFJh4o1poKAeOrCMpKDG/QvfCWHQw18peAedN5qCndDF/nwKStFZpRT5QB9/cPdQbRgFt6GTIRS8bkEnHadgPHQSnkBBfzdH5vPQywYKforOGUfBYujmAQpSytAZC+N0nERE1hQKprg10wyHfrZRYHZnuZMGHRVRkNoDyi0pp2AAdGStdP0qfK/yhZH8A+0Drh+8hmZCT3+jIKQJSs2IosAEXU3q3GFOzpCnfM2tHqeoFvpaR8EvzW2G3hcIe3Mm+tGpmdDX03TqLw9AkBVN5+Is0NdqtqMiHHcFJrAdqZ985Huj9uVbqzZP6gWJljy/efXZsRMrTkSzPafmwGZ/PJXKj49+svjd4Iidu7xODl617BWfGaq15Xg3DX8veUj1tD9FHJuVd7hgLhW6BJtYuqUhKM4/LaDRZDKbze8HB/89IuKrbi1qvNp89pMfvOjVZkvLk+MjIp4KDn7bbH7VZPpzwMgdQYV03VG0mkkP94kFPzhGTyVOW9Z4erovhMnFg/3bCgCX6Pm+BJCZSM83C8AVdgFzc4B57Ao+gzWRXcEAxLBLuI45DewKZgMmdgXZQFYCPd8eAJhvTqRnO34kDK0ueLf6mp7ktHercNwjlp7kYwXHQB7h03Q4MY2eJRlOTKdn8YVjVSH0LJVWOHSFnuY9OPQgPc0oJX9rGtlzVvA431MJ/HHI+Gj5uOC+va8p2bpv5V2HBqFV2NJHA0Kor0jT2ia02fdCxyvew85WVCvGPk7dRP16lLewwIrt8O7XAtr4h8PO8IczqIc/7poKO4vKabMVDvnRZjbuVXbrRAjlSl2+HQ68SZvuHYWsgkODjiVSnrg+MXDo98pDBsGJHruiKcfolWPgxGvKQ2Lg3AePpFFb5cXXtwyCc88qD+mBdtWtL4mjZmLfQPsC3QsRpY96jtqoSIfMEKDHQWqhdzokh+BqHNU3OhPSQ9CPqvu0CjqEhI2kynKXQo8QzKa68qdA5ZD7ochMqmsaFClRHhKajVZlpQNPetVunNjtiNfeSbBniaSa3ocDOXWly57wiekF2Jyl8hCWTywqWjm594R83lVeY4GoiqpaATtv/CqINqkT3rn0oNdvkl+s+JfSEOdMKzT92iqFqDqFDrkfwoR+Fty1JJqqKhamoEl5pGYhZHEVbGaYqLKA38Em7GIiNQ2hXzXuWPhBhB/VN2Jy0fNhAC5PJzUOIZ/53Jy3LpWaCZ3gfy6KEkKkMEKMECPECDFCjBAjxAgxQowQI8QIMUKMECPECDFCjBAjxAiRGrK4m/SkhPhCe0aIEWKEGCFGiBFihBghRkiXC3mJigRDe4VU5IBb94qNh/bWUZHlcGgnFfkntDeAiqyHQ1MrqcBuSFBVSAWOW+HY2RB2KONDyFDDjqX2hzNfh7ID/zkDOS42sAMpyXDu/PUUtiP6qxzIcvnzBLbj2o0YtMuyyMepC5AqrM7Hqav2L/4eDplRMvrhbCkAAAAASUVORK5CYII=",
  fridge: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHIAAADICAMAAAADUkVcAAABelBMVEUAAAAAAABHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC3tbxRAAAAfnRSTlP/VQAmK1nZFbOlD54BA5DgId0GWKjbPyXPKP49p978BSNEZoepy+2aDC5QcpO119bkEDGJB6FT9QRfC+Zk9/0Ja+4Sbr3wNHau3PYWd74bevKqOIH6w0yvSI74u0Fq+yySx1TOF9WUn+9Cskm04utdyWDNjNNX33246Orz9JldEyaZAAABzklEQVR42u3aOU9UURjG8Yc/CgozKMugTkGpdhoYHQFBxl1cwVFxVBIX3BJNXHD3q/kdbG0trG1or83NnYiZBJM7bzLw/KrT/XNOcfLm5ABAZXik54vaav7C+ckpAASw+k4hpo+nyeKAwhypgGBAgRYKiFWFmkNDgwpVO6lhBTulEQU7rZKCndFnmZmZmZmZmVknWHn85KlCHShCb48CjR0E2K5AJQC2KdAhALrVdmgdJ5100kknneycZKJw1WMAS4o0CRRuKVLj9lLXB4/WZlvT13AinJObKNkVzreE2X8ov6gp1t59cLSqSHsAzinQYQDO+qXSSSeddNJJJ7dosukjAIuKNA5wXZFKo8UTc3XFmpn1MG9mZmZmZmZmZmZmZmadp65w0/F7vKxgb3VJwd7o4rxCzXaLCYXqR1QeKtBgH4JHKwqzazcI6NupIDt6AQGwuHBNbVd9/gyyJAzVlJnoys1VNU3BX0leKjNObq6oqUhK/0qUm28zG/qWsv+7crP2e0PJRDlKnHSyzcmxXJM/PrVOJtnip/L0S6lG0jopteVkR9daJct5J5fXtwWpdCB5T87ulSVJ/QVSIvPgfr1+4ya5u3unsfz6VVbkD202gwlW5RWPAAAAAElFTkSuQmCC",
  area: "data:image/png;base64,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",
};

const WIZARD_STEPS = [
  {id:"extrair", label:"Extrair"},
  {id:"detalhes", label:"Detalhes"},
  {id:"capa", label:"Capa"},
  {id:"carrossel", label:"Carrossel"},
  {id:"publicar", label:"Publicar"}
];

function blankImovel(){
  return {
    status:"rascunho",
    codigo_unico:"", tipo_imovel:"Apartamento", bairro:"", cidade_estado: cfg.cidade_estado || "",
    numero_quartos:1, numero_banheiros:1, numero_vagas:1, numero_cozinhas:1, metragem:0,
    valor_aluguel:0, valor_condominio:0, valor_iptu:0,
    texto_bruto:"", link_origem:"",
    foto_principal_url:null,
    capa_feed_url:null, capa_story_url:null,
    fotos_carrossel:[], // [{url}]
    incluir_slide_cta:true,
    legenda:"", hashtags_selecionadas:[],
    // "nenhum" | "publicando" | "publicado" | "erro"
    instagram_status:"nenhum", instagram_post_id:null, instagram_permalink:null,
    instagram_erro_msg:"", instagram_publicado_em:null
  };
}

/* ============================================================
   STORE -- imóveis e configuração, via API deste backend
   ============================================================ */
const Store = {
  async listImoveis(){
    const r = await api("/api/imoveis");
    return r.imoveis;
  },
  async getImovel(id){
    try{ const r = await api("/api/imoveis/"+id); return r.imovel; }
    catch(e){ return null; }
  },
  async saveImovel(id, body){
    const r = id ? await api("/api/imoveis/"+id, {method:"POST", body}) : await api("/api/imoveis", {method:"POST", body});
    return r.imovel.id;
  },
  async deleteImovel(id){
    await api("/api/imoveis/"+id, {method:"DELETE"});
  },
  async getConfig(){
    const r = await api("/api/publicador/config");
    return r.config;
  },
  async saveConfig(body){
    await api("/api/publicador/config", {method:"POST", body});
  },
  async publicarInstagram(id){
    const r = await api("/api/imoveis/"+id+"/publicar-instagram", {method:"POST", body:{}});
    return r.imovel;
  }
};

/* ============================================================
   ASSET STORE -- upload direto (sem assinatura) para o Cloudinary
   ============================================================ */
const AssetStore = {
  async uploadBlob(blob){
    if (!cfg.cloudinary_cloud_name || !cfg.cloudinary_upload_preset){
      throw new Error('Configure o Cloudinary em "Configurações" antes de gerar imagens.');
    }
    const form = new FormData();
    form.append("file", blob);
    form.append("upload_preset", cfg.cloudinary_upload_preset);
    const res = await fetch("https://api.cloudinary.com/v1_1/"+cfg.cloudinary_cloud_name+"/image/upload", {
      method:"POST", body: form
    });
    let json = null;
    try{ json = await res.json(); }catch(e){ /* ignore */ }
    if (!res.ok || !json || !json.secure_url){
      const msg = (json && json.error && json.error.message) || ("HTTP "+res.status);
      throw new Error("Falha ao enviar imagem para o Cloudinary: "+msg);
    }
    return {id: json.public_id, url: json.secure_url};
  }
};

/* ============================================================
   TOASTS & MODAL
   ============================================================ */
function toast(msg, isErr){
  const wrap = document.getElementById("toastWrap");
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .3s"; setTimeout(()=>el.remove(),300); }, 3200);
}

function confirmModal(title, body, confirmLabel){
  return new Promise((resolve)=>{
    const root = document.getElementById("modalRoot");
    root.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = '<h3></h3><p></p><div class="actions"><button class="btn btn-ghost" id="mCancel">Cancelar</button><button class="btn btn-danger" id="mOk" style="background:var(--red);color:#fff;border-color:var(--red);"></button></div>';
    modal.querySelector("h3").textContent = title;
    modal.querySelector("p").textContent = body;
    modal.querySelector("#mOk").textContent = confirmLabel || "Confirmar";
    overlay.appendChild(modal);
    root.appendChild(overlay);
    function close(val){ root.innerHTML=""; resolve(val); }
    overlay.addEventListener("click",(e)=>{ if(e.target===overlay) close(false); });
    modal.querySelector("#mCancel").addEventListener("click", ()=>close(false));
    modal.querySelector("#mOk").addEventListener("click", ()=>close(true));
  });
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
function fmtMoney(v){
  const n = Number(v)||0;
  return n.toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtDataCurta(iso){
  if (!iso) return "";
  try{ return new Date(iso).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}); }
  catch(e){ return iso; }
}
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ============================================================
   CANVAS COMPOSITION -- feed / story / carrossel / cta
   (idêntico ao Artifact original -- é só HTML5 canvas, roda em qualquer navegador)
   ============================================================ */
function roundedRectPath(ctx,x,y,w,h,r){
  if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); return; }
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}
function fillRoundRect(ctx,x,y,w,h,r,color){
  ctx.fillStyle = color;
  roundedRectPath(ctx,x,y,w,h,r);
  ctx.fill();
}
function drawCover(ctx, img, dx, dy, dw, dh){
  const ir = img.width/img.height, dr = dw/dh;
  let sx,sy,sw,sh;
  if (ir > dr){ sh = img.height; sw = sh*dr; sx=(img.width-sw)/2; sy=0; }
  else { sw = img.width; sh = sw/dr; sx=0; sy=(img.height-sh)/2; }
  ctx.drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh);
}
function fitText(ctx, text, maxWidth, family, weight, startSize, minSize){
  let size = startSize;
  while (size > minSize){
    ctx.font = weight+" "+size+"px "+family;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  ctx.font = weight+" "+size+"px "+family;
  return size;
}
function darkOverlayGradient(ctx,x,y,w,h,fromAlpha,toAlpha){
  const g = ctx.createLinearGradient(x,y,x,y+h);
  g.addColorStop(0, "rgba(0,0,0,"+fromAlpha+")");
  g.addColorStop(1, "rgba(0,0,0,"+toAlpha+")");
  ctx.fillStyle = g;
  ctx.fillRect(x,y,w,h);
}

const ICON_IMG = {};
let _iconsReadyPromise = null;
function ensureIconsLoaded(){
  if (_iconsReadyPromise) return _iconsReadyPromise;
  _iconsReadyPromise = Promise.all(Object.keys(ICON_SRC).map(key=>
    new Promise(resolve=>{
      const img = new Image();
      img.onload = ()=>{ ICON_IMG[key] = img; resolve(); };
      img.onerror = ()=> resolve();
      img.src = ICON_SRC[key];
    })
  ));
  return _iconsReadyPromise;
}
const _tintCanvasCache = {};
function drawTintedIcon(ctx, iconKey, x, y, w, h, color){
  const img = ICON_IMG[iconKey];
  if (!img) return;
  const cacheKey = iconKey+"|"+color;
  let tinted = _tintCanvasCache[cacheKey];
  if (!tinted){
    tinted = document.createElement("canvas");
    tinted.width = img.naturalWidth; tinted.height = img.naturalHeight;
    const tctx = tinted.getContext("2d");
    tctx.drawImage(img, 0, 0);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, tinted.width, tinted.height);
    _tintCanvasCache[cacheKey] = tinted;
  }
  ctx.drawImage(tinted, x, y, w, h);
}

let _fontsReadyPromise = null;
function ensureFontsLoaded(){
  if (_fontsReadyPromise) return _fontsReadyPromise;
  const specs = [
    "500 16px Poppins","600 16px Poppins","700 16px Poppins","800 16px Poppins",
    "400 16px Inter","500 16px Inter","600 16px Inter","700 16px Inter",
    "500 16px 'JetBrains Mono'","700 16px 'JetBrains Mono'"
  ];
  _fontsReadyPromise = Promise.all(
    specs.map(s=>{ try{ return document.fonts.load(s); } catch(e){ return Promise.resolve(); } })
  ).catch(()=>{}).then(()=> (document.fonts.ready || Promise.resolve())).catch(()=>{});
  return _fontsReadyPromise;
}

// Logo da marca (opcional), carregado de uma URL do Cloudinary. Cacheado por
// URL -- a mesma capa pode ser gerada (feed + story) sem baixar o logo duas
// vezes, e trocar o logo em Configurações naturalmente usa uma URL nova.
// crossOrigin="anonymous" é obrigatório: sem isso, o navegador marca o
// canvas como "tainted" (mesmo o Cloudinary enviando os cabeçalhos CORS
// certos) e canvas.toBlob() para de funcionar silenciosamente.
const _logoImgCache = {};
function getLogoImage(url){
  if (_logoImgCache[url]) return _logoImgCache[url];
  _logoImgCache[url] = new Promise((resolve, reject)=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=> resolve(img);
    img.onerror = ()=> reject(new Error("Falha ao carregar o logo"));
    img.src = url;
  });
  return _logoImgCache[url];
}

async function composeCapa(format, img, dados, cores){
  await Promise.all([ensureFontsLoaded(), ensureIconsLoaded()]);
  const dim = format === "story" ? DIM_STORY : DIM_FEED;
  const canvas = document.createElement("canvas");
  canvas.width = dim.w; canvas.height = dim.h;
  const ctx = canvas.getContext("2d");
  const RED = cores.cor_vermelho || "#9e0000";
  const BLACK = cores.cor_preto || "#000000";
  const WHITE = cores.cor_branco || "#ffffff";

  const FOOTER_H = 394;
  const photoBottom = dim.h - FOOTER_H;
  const off = dim.h - 1350;
  const Y = (raw)=> raw + off;

  ctx.fillStyle = WHITE;
  ctx.fillRect(0,0,dim.w,dim.h);

  if (img) drawCover(ctx, img, 0, 0, dim.w, photoBottom);
  else { ctx.fillStyle = "#d8d3c8"; ctx.fillRect(0,0,dim.w,photoBottom); }

  darkOverlayGradient(ctx, 0, photoBottom-140, dim.w, 140, 0, 0.0);
  const fade = ctx.createLinearGradient(0, photoBottom-90, 0, photoBottom);
  fade.addColorStop(0,"rgba(255,255,255,0)"); fade.addColorStop(1,"rgba(255,255,255,1)");
  ctx.fillStyle = fade; ctx.fillRect(0, photoBottom-90, dim.w, 90);

  const TOP_BAR_H = 78;
  ctx.fillStyle = RED; ctx.fillRect(0, 0, dim.w, TOP_BAR_H);
  if (dados.codigo_unico){
    ctx.font = "700 42px Poppins"; ctx.fillStyle = WHITE;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(dados.codigo_unico.toUpperCase(), dim.w/2, TOP_BAR_H/2+2);
  }

  ctx.fillStyle = WHITE; ctx.fillRect(0, photoBottom, dim.w, FOOTER_H);

  const pad = 48;

  const tipoAbrev = TIPO_ABREVIADO[dados.tipo_imovel] || (dados.tipo_imovel||"IMÓVEL").toUpperCase();
  const pillTipoY = Y(969.6), pillTipoH = 65.4, pillTipoW = 405;
  ctx.lineWidth = 5; ctx.strokeStyle = RED;
  roundedRectPath(ctx, pad, pillTipoY, pillTipoW, pillTipoH, pillTipoH/2);
  ctx.stroke();
  ctx.font = "700 35px Poppins"; ctx.fillStyle = BLACK;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tipoAbrev+"/ LOCAÇÃO", pad+pillTipoW/2, pillTipoY+pillTipoH/2+2);

  const priceY = Y(1040), priceH = 105, priceW = 416;
  fillRoundRect(ctx, pad, priceY, priceW, priceH, priceH/2, RED);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.font = "500 31px Inter"; ctx.fillStyle = WHITE;
  ctx.fillText("R$", pad+30, priceY+priceH*0.46);
  ctx.font = "800 62px Poppins";
  ctx.fillText(fmtMoney(dados.valor_aluguel), pad+82, priceY+priceH*0.7);

  const bairroZoneX = pad+priceW+16, bairroZoneW = (dim.w-pad) - bairroZoneX;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const bairroTxt = (dados.bairro||"Bairro não informado")+" - "+(dados.cidade_estado||"");
  fitText(ctx, bairroTxt, bairroZoneW, "Poppins", 700, 35, 18);
  ctx.fillStyle = BLACK;
  ctx.fillText(bairroTxt, bairroZoneX+bairroZoneW/2, priceY+priceH/2);

  const specY = Y(1150), specH = 115.5, specW = 707;
  fillRoundRect(ctx, pad, specY, specW, specH, 30, RED);

  const iconH = 54, iconTopY = specY + 20;
  const labelY = specY + specH - 24;
  const clusters = [
    {num:dados.numero_quartos, iconKey:"bed", aspect:72.2/55.9, label:"QUARTOS", center:118},
    {num:dados.numero_banheiros, iconKey:"toilet", aspect:36.5/55.9, label:"BANHEIROS", center:271},
    {num:dados.numero_vagas, iconKey:"car", aspect:70.1/55.9, label:"VAGAS", center:419},
    {num:dados.numero_cozinhas, iconKey:"fridge", aspect:31.9/55.9, label:"COZINHA", center:556},
  ];
  clusters.forEach(cl=>{
    const iconW = iconH*cl.aspect;
    let numW = 0;
    const numText = String(cl.num!=null?cl.num:0).padStart(2,"0");
    ctx.font = "700 29px Poppins";
    numW = ctx.measureText(numText).width;
    const groupW = numW+14+iconW;
    let cx0 = cl.center - groupW/2;
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = WHITE;
    ctx.fillText(numText, cx0, iconTopY+iconH/2+1);
    cx0 += numW+14;
    drawTintedIcon(ctx, cl.iconKey, cx0, iconTopY, iconW, iconH, WHITE);
    ctx.font = "700 19px Inter"; ctx.textAlign = "center"; ctx.fillStyle = WHITE;
    ctx.fillText(cl.label, cl.center, labelY);
  });
  const areaCenter = 695, areaIconW = iconH*(71.5/54.6);
  drawTintedIcon(ctx, "area", areaCenter-areaIconW/2, iconTopY, areaIconW, iconH, WHITE);
  ctx.font = "700 22px Poppins"; ctx.textAlign = "center"; ctx.fillStyle = WHITE;
  ctx.fillText((dados.metragem||0)+"m²", areaCenter, labelY);

  // A caixinha da marca tem largura fixa (o resto do layout depende disso
  // para se alinhar), mas o nome da marca e o slogan são texto livre digitado
  // em Configurações -- podem ser mais compridos que "Seu Lugar" /
  // "Imobiliária Descomplicada". fitText encolhe a fonte até caber; o clip()
  // é uma segunda trava de segurança (nada desenha fora da caixinha branca,
  // mesmo num caso extremo de uma palavra única enorme que não encolhe mais).
  const cardX = pad+specW+20, cardY = Y(1157.7), cardW = dim.w-pad-cardX, cardH = 100.3;
  fillRoundRect(ctx, cardX, cardY, cardW, cardH, 12, WHITE);
  const cardTextMaxW = cardW - 16;
  ctx.save();
  roundedRectPath(ctx, cardX, cardY, cardW, cardH, 12);
  ctx.clip();
  let logoDesenhado = false;
  if (cfg.logo_url){
    try{
      const logoImg = await getLogoImage(cfg.logo_url);
      const logoPad = 12;
      const maxW = cardW - logoPad*2, maxH = cardH - logoPad*2;
      const scale = Math.min(maxW/logoImg.naturalWidth, maxH/logoImg.naturalHeight);
      const lw = logoImg.naturalWidth*scale, lh = logoImg.naturalHeight*scale;
      ctx.drawImage(logoImg, cardX+(cardW-lw)/2, cardY+(cardH-lh)/2, lw, lh);
      logoDesenhado = true;
    }catch(e){
      console.warn("Não consegui carregar o logo, usando o nome da marca em texto.", e);
    }
  }
  if (!logoDesenhado){
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = RED;
    fitText(ctx, (cfg.nome_marca||"Seu Lugar").toUpperCase(), cardTextMaxW, "Poppins", 800, 26, 11);
    ctx.fillText((cfg.nome_marca||"Seu Lugar").toUpperCase(), cardX+cardW/2, cardY+cardH*0.4);
    ctx.fillStyle = "#4a4a4a";
    fitText(ctx, cfg.slogan||"", cardTextMaxW, "Inter", 600, 13, 9);
    ctx.fillText(cfg.slogan||"", cardX+cardW/2, cardY+cardH*0.72);
  }
  ctx.restore();

  ctx.fillStyle = RED; ctx.fillRect(0, Y(1280.25), dim.w, 69.75);

  return canvas;
}

async function composeCarouselSlide(img, dados, index, total, cores){
  await Promise.all([ensureFontsLoaded(), ensureIconsLoaded()]);
  const dim = DIM_FEED;
  const canvas = document.createElement("canvas");
  canvas.width = dim.w; canvas.height = dim.h;
  const ctx = canvas.getContext("2d");
  const RED = cores.cor_vermelho || "#ff161f";
  const WHITE = cores.cor_branco || "#ffffff";

  drawCover(ctx, img, 0, 0, dim.w, dim.h);
  darkOverlayGradient(ctx, 0, dim.h-260, dim.w, 260, 0, 0.62);
  darkOverlayGradient(ctx, 0, 0, dim.w, 140, 0.30, 0);

  const pad = 44;
  ctx.font = "700 24px 'JetBrains Mono'";
  const counterText = (index+1)+"/"+total;
  const cw = ctx.measureText(counterText).width + 30;
  fillRoundRect(ctx, dim.w-pad-cw, 36, cw, 44, 22, "rgba(17,17,17,.68)");
  ctx.fillStyle = WHITE; ctx.textAlign="left"; ctx.textBaseline="middle";
  ctx.fillText(counterText, dim.w-pad-cw+15, 36+22);

  ctx.font = "700 22px Poppins";
  const brandText = (dados.marca||"Seu Lugar").toUpperCase();
  const bw = ctx.measureText(brandText).width + 30;
  fillRoundRect(ctx, pad, 36, bw, 44, 22, RED);
  ctx.fillStyle = WHITE;
  ctx.fillText(brandText, pad+15, 36+22);

  ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  ctx.font = "700 40px Poppins"; ctx.fillStyle = WHITE;
  ctx.fillText(dados.bairro||"", pad, dim.h-96);
  ctx.font = "500 24px Inter"; ctx.fillStyle = "rgba(255,255,255,.85)";
  const sub = (dados.tipo_imovel||"") + (dados.codigo_unico ? "  ·  #"+dados.codigo_unico : "");
  ctx.fillText(sub, pad, dim.h-58);

  return canvas;
}

async function composeCTASlide(dados, cores){
  await Promise.all([ensureFontsLoaded(), ensureIconsLoaded()]);
  const dim = DIM_FEED;
  const canvas = document.createElement("canvas");
  canvas.width = dim.w; canvas.height = dim.h;
  const ctx = canvas.getContext("2d");
  const RED = cores.cor_vermelho || "#ff161f";
  const WHITE = cores.cor_branco || "#ffffff";
  const BLACK = cores.cor_preto || "#000000";

  ctx.fillStyle = RED; ctx.fillRect(0,0,dim.w,dim.h);
  ctx.fillStyle = "rgba(0,0,0,.08)";
  for (let i=0;i<6;i++){ ctx.beginPath(); ctx.arc(dim.w*(i%2?0.9:0.05), dim.h*0.15*i, 220, 0, Math.PI*2); ctx.fill(); }

  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.font = "800 64px Poppins"; ctx.fillStyle = WHITE;
  wrapCenteredText(ctx, cfg.cta_final || "Comente \"Alugar\"", dim.w/2, dim.h*0.42, dim.w-160, 74);

  ctx.font = "600 30px Inter"; ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText("ou chame no direct para saber mais", dim.w/2, dim.h*0.42+110);

  const cardW = dim.w-160, cardH = 130, cardY = dim.h-260;
  fillRoundRect(ctx, 80, cardY, cardW, cardH, 24, WHITE);
  ctx.font = "800 40px Poppins"; ctx.fillStyle = BLACK;
  ctx.fillText(cfg.nome_marca || "Seu Lugar", dim.w/2, cardY+52);
  ctx.font = "500 22px Inter"; ctx.fillStyle = "#6b6558";
  ctx.fillText((cfg.slogan||"") + (dados.codigo_unico ? "   ·   #"+dados.codigo_unico : ""), dim.w/2, cardY+92);

  return canvas;
}
function wrapCenteredText(ctx, text, cx, cy, maxWidth, lineHeight){
  const words = text.split(" ");
  const lines = []; let cur = "";
  words.forEach(w=>{
    const test = cur ? cur+" "+w : w;
    if (ctx.measureText(test).width > maxWidth && cur){ lines.push(cur); cur = w; }
    else cur = test;
  });
  if (cur) lines.push(cur);
  const startY = cy - (lines.length-1)*lineHeight/2;
  lines.forEach((line,i)=> ctx.fillText(line, cx, startY+i*lineHeight));
}

function canvasToBlob(canvas){
  return new Promise(res=> canvas.toBlob(b=>res(b), "image/png"));
}
function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>resolve({img,url,file});
    img.onerror = reject;
    img.src = url;
  });
}
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   EXTRAÇÃO POR IA (via backend -- API da Anthropic)
   ============================================================ */
async function extrairComIA(textoBruto, linkOrigem){
  const r = await api("/api/publicador/extrair-ia", {method:"POST", body:{texto:textoBruto, link:linkOrigem}});
  return r.data;
}

function aplicarDadosExtraidos(data){
  Object.assign(draft, {
    tipo_imovel: data.tipo_imovel || draft.tipo_imovel,
    bairro: data.bairro || draft.bairro,
    cidade_estado: data.cidade_estado || draft.cidade_estado,
    numero_quartos: Number(data.numero_quartos)||0,
    numero_banheiros: Number(data.numero_banheiros)||0,
    numero_vagas: Number(data.numero_vagas)||0,
    numero_cozinhas: Number(data.numero_cozinhas)||1,
    metragem: Number(data.metragem)||0,
    valor_aluguel: Number(data.valor_aluguel)||0,
    valor_condominio: Number(data.valor_condominio)||0,
    valor_iptu: Number(data.valor_iptu)||0,
    codigo_unico: draft.codigo_unico || data.codigo_unico || ""
  });
}

/* ============================================================
   CAPTION BUILDING
   ============================================================ */
function buildLegenda(dados, template){
  const map = {
    tipo_imovel: dados.tipo_imovel||"", bairro: dados.bairro||"", codigo_unico: dados.codigo_unico||"",
    numero_quartos: dados.numero_quartos||0, quartos_label:LABEL_QUARTOS,
    numero_banheiros: dados.numero_banheiros||0, banheiros_label:LABEL_BANHEIROS,
    numero_vagas: dados.numero_vagas||0, vagas_label:LABEL_VAGAS,
    numero_cozinhas: dados.numero_cozinhas||0, cozinhas_label:LABEL_COZINHAS,
    metragem: dados.metragem||0,
    valor_aluguel: fmtMoney(dados.valor_aluguel), valor_condominio: fmtMoney(dados.valor_condominio),
    valor_iptu: fmtMoney(dados.valor_iptu)
  };
  return template.replace(/\{(\w+)\}/g, (m,k)=> (k in map) ? map[k] : m);
}

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let cfg = Object.assign({}, DEFAULT_CONFIG);
let currentView = "dashboard";
let wizardStep = 0;
let draft = null;
let draftId = null;
let capaFotoObj = null;
let carrosselFotos = [];

function revogarUrlSeTemporaria(url){
  if (url && typeof url === "string" && url.indexOf("blob:") === 0){
    try{ URL.revokeObjectURL(url); }catch(e){ /* ignore */ }
  }
}
function limparFotosTemporariasDoWizard(){
  revogarUrlSeTemporaria(capaFotoObj && capaFotoObj.url);
  (carrosselFotos||[]).forEach(f=> revogarUrlSeTemporaria(f && f.url));
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function setView(name){
  currentView = name;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-"+name).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===name));
  window.scrollTo({top:0,behavior:"smooth"});
}

document.getElementById("mainTabs").addEventListener("click",(e)=>{
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  if (btn.dataset.view==="dashboard") renderDashboard();
  if (btn.dataset.view==="config") renderConfig();
  setView(btn.dataset.view);
});

/* ============================================================
   DASHBOARD
   ============================================================ */
function buildImovelCard(item){
  const card = document.createElement("div");
  card.className = "card";
  const statusLabel = item.status==="baixado" ? "Baixado" : (item.status==="pronto" ? "Pronto pra postar" : "Rascunho");
  const statusClass = item.status==="baixado" ? "badge-baixado" : (item.status==="pronto" ? "badge-pronto" : "badge-rascunho");
  const dataLinha = item.instagram_status==="publicado" && item.instagram_publicado_em
    ? "Publicado "+fmtDataCurta(item.instagram_publicado_em)
    : "Criado "+fmtDataCurta(item.createdAt || item.updatedAt);
  card.innerHTML =
    '<div class="card-thumb">'+
      (item.capa_feed_url
        ? '<img src="'+item.capa_feed_url+'" alt="">'
        : '<div class="placeholder"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 16l4.5-4.5a2 2 0 0 1 2.8 0L15 15m0 0l1.5-1.5a2 2 0 0 1 2.8 0L21 16M4 8h16M4 4h16v16H4V4z" stroke="currentColor" stroke-width="1.3"/></svg>sem capa</div>') +
      '<span class="badge '+statusClass+'">'+statusLabel+'</span>'+
    '</div>'+
    '<div class="card-body">'+
      '<div class="card-title">'+escapeHtml(item.tipo_imovel||"Imóvel")+' · '+escapeHtml(item.bairro||"—")+'</div>'+
      '<div class="card-sub">'+escapeHtml(item.codigo_unico ? "#"+item.codigo_unico : "sem código")+' · '+escapeHtml(item.cidade_estado||"")+'</div>'+
      '<div class="card-price">R$ '+fmtMoney(item.valor_aluguel)+'/mês</div>'+
      '<div class="card-date">'+dataLinha+'</div>'+
      (item.link_origem ? '<a href="'+escapeHtml(item.link_origem)+'" target="_blank" rel="noopener" class="card-link">🔗 Anúncio original</a>' : '')+
      (item.instagram_status==="publicado" ? '<div class="card-ig-line" style="color:var(--success);">✓ Publicado no Instagram</div>'
        : item.instagram_status==="erro" ? '<div class="card-ig-line" style="color:var(--red);">⚠️ Erro ao publicar</div>'
        : '')+
      (item.instagram_status==="publicado" && item.instagram_permalink ? '<a href="'+escapeHtml(item.instagram_permalink)+'" target="_blank" rel="noopener" class="card-link">📷 Ver no Instagram</a>' : '')+
      '<div class="card-actions">'+
        '<button class="btn btn-ghost btn-sm" style="flex:1;" data-act="edit" data-id="'+item.id+'">Continuar</button>'+
        '<button class="btn btn-danger btn-sm" data-act="del" data-id="'+item.id+'">Excluir</button>'+
      '</div>'+
    '</div>';
  return card;
}
async function onImovelListClick(e){
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "edit"){
    await openImovel(id);
  } else if (btn.dataset.act === "del"){
    const ok = await confirmModal("Excluir imóvel?", "Isso remove o rascunho e as imagens geradas para este imóvel. Essa ação não pode ser desfeita.", "Excluir");
    if (!ok) return;
    try{
      await Store.deleteImovel(id);
      toast("Imóvel excluído.");
      if (currentView === "biblioteca") renderBiblioteca(); else renderDashboard();
    }catch(err){ toast("Não foi possível excluir.", true); }
  }
}
async function renderDashboard(){
  const banner = document.getElementById("capabilityBanner");
  if (!cfg.cloudinary_cloud_name || !cfg.cloudinary_upload_preset){
    banner.style.display = "flex";
    banner.className = "banner warn";
    banner.innerHTML = "<span>⚠️</span><span><b>Cloudinary não configurado.</b> As imagens (capa/carrossel) precisam de uma conta gratuita do Cloudinary para serem salvas -- configure em <b>Configurações</b>.</span>";
  } else {
    banner.style.display = "none";
  }

  const body = document.getElementById("dashboardBody");
  body.innerHTML = '<div class="status-line"><div class="spinner"></div>Carregando imóveis…</div>';
  let list;
  try{ list = await Store.listImoveis(); }
  catch(err){ body.innerHTML = '<div class="empty-state"><h3>Não foi possível carregar</h3><p>'+escapeHtml(err.message)+'</p></div>'; return; }
  if (!list.length){
    body.innerHTML = '<div class="empty-state">'+
      '<div class="icon-wrap"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 11.5L12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
      '<h3>Nenhum imóvel ainda</h3>'+
      '<p>Crie o primeiro imóvel para gerar a capa, o carrossel e a legenda prontos para baixar.</p>'+
      '<button class="btn btn-primary" id="btnNovoImovelEmpty">Novo imóvel</button>'+
      '</div>';
    document.getElementById("btnNovoImovelEmpty").addEventListener("click", startNovoImovel);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid-cards";
  list.forEach(item=> grid.appendChild(buildImovelCard(item)));
  body.innerHTML = "";
  body.appendChild(grid);
  body.removeEventListener("click", onImovelListClick);
  body.addEventListener("click", onImovelListClick);
}

let _bibliotecaCache = null;
async function renderBiblioteca(){
  const body = document.getElementById("bibliotecaBody");
  body.innerHTML = '<div class="status-line"><div class="spinner"></div>Carregando imóveis…</div>';
  _bibliotecaCache = await Store.listImoveis();
  aplicarFiltroBiblioteca();
  body.removeEventListener("click", onImovelListClick);
  body.addEventListener("click", onImovelListClick);
}
function aplicarFiltroBiblioteca(){
  const body = document.getElementById("bibliotecaBody");
  const termo = (document.getElementById("bibliotecaBusca").value||"").trim().toLowerCase();
  const list = (_bibliotecaCache||[]).filter(item=>{
    if (!termo) return true;
    return [item.codigo_unico, item.bairro, item.tipo_imovel, item.cidade_estado]
      .some(v=> String(v||"").toLowerCase().includes(termo));
  });
  if (!list.length){
    body.innerHTML = '<div class="empty-state"><h3>Nenhum imóvel encontrado</h3><p>Tente buscar por outro código, bairro ou tipo.</p></div>';
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid-cards";
  list.forEach(item=> grid.appendChild(buildImovelCard(item)));
  body.innerHTML = "";
  body.appendChild(grid);
}
document.getElementById("bibliotecaBusca").addEventListener("input", aplicarFiltroBiblioteca);
document.getElementById("btnBiblioteca").addEventListener("click", ()=>{ renderBiblioteca(); setView("biblioteca"); });
document.getElementById("btnVoltarBiblioteca").addEventListener("click", ()=>{ renderDashboard(); setView("dashboard"); });

async function renderHistorico(){
  const body = document.getElementById("historicoBody");
  body.innerHTML = '<div class="status-line"><div class="spinner"></div>Carregando…</div>';
  const list = (await Store.listImoveis()).filter(item=> item.status==="baixado" || item.instagram_status==="publicado");
  if (!list.length){
    body.innerHTML = '<div class="empty-state">'+
      '<h3>Nada baixado ou publicado ainda</h3>'+
      '<p>Assim que você baixar o conteúdo de um imóvel (.zip) ou publicar no Instagram, ele aparece aqui.</p>'+
      '</div>';
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid-cards";
  list.forEach(item=> grid.appendChild(buildImovelCard(item)));
  body.innerHTML = "";
  body.appendChild(grid);
  body.removeEventListener("click", onImovelListClick);
  body.addEventListener("click", onImovelListClick);
}
document.getElementById("btnHistorico").addEventListener("click", ()=>{ renderHistorico(); setView("historico"); });
document.getElementById("btnVoltarHistorico").addEventListener("click", ()=>{ renderDashboard(); setView("dashboard"); });

document.getElementById("btnNovoImovel").addEventListener("click", startNovoImovel);
function startNovoImovel(){
  limparFotosTemporariasDoWizard();
  draft = blankImovel();
  draftId = null;
  capaFotoObj = null;
  carrosselFotos = [];
  wizardStep = 0;
  renderWizard();
  setView("wizard");
}
async function openImovel(id){
  const item = await Store.getImovel(id);
  if (!item){ toast("Imóvel não encontrado.", true); return; }
  limparFotosTemporariasDoWizard();
  draft = item;
  draftId = id;
  capaFotoObj = null;
  carrosselFotos = (item.fotos_carrossel||[]).map(f=>({img:null,url:f.url,file:null}));
  wizardStep = draft.capa_feed_url ? (draft.fotos_carrossel && draft.fotos_carrossel.length ? 4 : 3) : (draft.tipo_imovel && draft.bairro ? 2 : 0);
  renderWizard();
  setView("wizard");
}

/* ============================================================
   WIZARD SHELL
   ============================================================ */
function renderStepper(){
  const el = document.getElementById("stepper");
  el.innerHTML = "";
  WIZARD_STEPS.forEach((s,i)=>{
    if (i>0){ const c = document.createElement("div"); c.className="step-connector"; el.appendChild(c); }
    const pill = document.createElement("div");
    pill.className = "step-pill" + (i===wizardStep ? " active" : "") + (i<wizardStep ? " done" : "");
    pill.innerHTML = '<span class="num">'+(i<wizardStep ? "✓" : (i+1))+'</span>'+s.label;
    el.appendChild(pill);
  });
}
async function persistDraft(patch){
  Object.assign(draft, patch||{});
  try{
    const id = await Store.saveImovel(draftId, draft);
    draftId = id;
  }catch(e){ toast("Não foi possível salvar: "+e.message, true); }
}
function renderWizard(){
  renderStepper();
  const step = WIZARD_STEPS[wizardStep].id;
  const panel = document.getElementById("wizardPanel");
  if (step==="extrair") renderStepExtrair(panel);
  else if (step==="capa") renderStepCapa(panel);
  else if (step==="carrossel") renderStepCarrossel(panel);
  else if (step==="detalhes") renderStepDetalhes(panel);
  else if (step==="publicar") renderStepPublicar(panel);
}
function wizardNav(panel, {backLabel, nextLabel, onBack, onNext, nextDisabled}){
  const nav = document.createElement("div");
  nav.className = "wizard-nav";
  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-ghost";
  backBtn.textContent = backLabel || "Voltar";
  backBtn.addEventListener("click", onBack);
  const nextBtn = document.createElement("button");
  nextBtn.className = "btn btn-primary";
  nextBtn.textContent = nextLabel || "Continuar";
  nextBtn.disabled = !!nextDisabled;
  nextBtn.addEventListener("click", onNext);
  nav.appendChild(backBtn);
  nav.appendChild(nextBtn);
  panel.appendChild(nav);
}

/* ---- Etapa 1: Extrair ---- */
function renderStepExtrair(panel){
  panel.innerHTML =
    '<h3 style="margin-bottom:6px;">Extrair dados do imóvel</h3>'+
    '<p style="color:var(--text-muted);font-size:.87rem;margin-bottom:18px;">Cole o link do anúncio (ou a descrição, se preferir) e deixe a IA preencher os campos — ou pule direto para o preenchimento manual.</p>'+
    '<div class="field"><label>Código do imóvel (opcional)</label><input type="text" id="fCodigo" value="'+escapeHtml(draft.codigo_unico)+'" placeholder="Ex: AP-1042"></div>'+
    '<div class="field"><label>Link do anúncio (opcional)</label>'+
      '<div style="display:flex;gap:8px;">'+
        '<input type="text" id="fLink" value="'+escapeHtml(draft.link_origem)+'" placeholder="https://..." style="flex:1;">'+
        '<button class="btn btn-primary" id="btnExtrairIA" type="button" style="white-space:nowrap;">✨ Extrair com IA</button>'+
      '</div>'+
      '<span class="hint">Cole o link e clique em "Extrair com IA" -- o servidor busca a página e preenche os campos sozinho. Sem link, clique no mesmo botão com o texto colado abaixo. Se o site bloquear acesso automatizado, copie o texto da página (Ctrl+A, Ctrl+C) e cole no campo abaixo antes de clicar.</span>'+
    '</div>'+
    '<div class="field"><label>Descrição / anúncio</label><textarea id="fTexto" rows="8" placeholder="Cole aqui o texto do anúncio: quartos, banheiros, vagas, metragem, valores, bairro etc.">'+escapeHtml(draft.texto_bruto)+'</textarea></div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;">'+
      '<button class="btn btn-ghost" id="btnPularIA">Preencher manualmente</button>'+
    '</div>'+
    '<div id="extrairStatus"></div>';

  panel.querySelector("#fCodigo").addEventListener("input", e=> draft.codigo_unico = e.target.value);
  panel.querySelector("#fLink").addEventListener("input", e=> draft.link_origem = e.target.value);
  panel.querySelector("#fTexto").addEventListener("input", e=> draft.texto_bruto = e.target.value);

  panel.querySelector("#btnPularIA").addEventListener("click", async ()=>{
    await persistDraft();
    wizardStep = 1; renderWizard();
  });

  // Botão único: com link preenchido, lê a página (direto pela API da Seu
  // Lugar quando o link é do nosso próprio sistema -- mais rápido e sem
  // gastar chamada de IA -- ou via leitura genérica + IA para outros sites);
  // sem link, extrai direto do texto colado na caixa abaixo.
  panel.querySelector("#btnExtrairIA").addEventListener("click", async ()=>{
    const url = (panel.querySelector("#fLink").value||"").trim();
    const statusEl = panel.querySelector("#extrairStatus");

    if (url){
      if (!/^https?:\/\/\S+/i.test(url)){ toast("Isso não parece um link válido (deve começar com http:// ou https://).", true); return; }
      draft.link_origem = url;
      statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Lendo a página do anúncio…</div>';
      let r;
      try{
        r = await api("/api/publicador/ler-link", {method:"POST", body:{link:url}});
      }catch(err){
        statusEl.innerHTML = '<div class="status-line" style="color:var(--red);">'+escapeHtml(err.message || "Não consegui ler o link automaticamente. Copie o texto da página e cole manualmente abaixo.")+'</div>';
        return;
      }
      if (r.texto){
        panel.querySelector("#fTexto").value = r.texto;
        draft.texto_bruto = r.texto;
      }
      if (r.dados){
        // Já veio estruturado (link do nosso próprio sistema) -- sem
        // precisar chamar a IA, é mais rápido e 100% preciso.
        aplicarDadosExtraidos(r.dados);
        statusEl.innerHTML = '<div class="status-line" style="color:var(--success);">✓ Dados lidos direto do sistema — confira e ajuste na etapa de Detalhes.</div>';
        toast("Dados extraídos automaticamente do link.");
        await persistDraft();
        setTimeout(()=>{ wizardStep = 1; renderWizard(); }, 700);
        return;
      }
      statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Página lida — extraindo os dados com IA…</div>';
      try{
        const data = await extrairComIA(r.texto, url);
        aplicarDadosExtraidos(data);
        statusEl.innerHTML = '<div class="status-line" style="color:var(--success);">✓ Link lido e dados extraídos automaticamente — confira e ajuste na etapa de Detalhes.</div>';
        toast("Dados extraídos automaticamente do link.");
        await persistDraft();
        setTimeout(()=>{ wizardStep = 1; renderWizard(); }, 700);
      }catch(err){
        statusEl.innerHTML = '<div class="status-line" style="color:var(--warn);">Página lida, mas a IA não conseguiu extrair os dados automaticamente. Revise o texto acima e clique em "Extrair com IA" de novo (sem link, ele usa o texto colado).</div>';
      }
      return;
    }

    const texto = panel.querySelector("#fTexto").value.trim();
    if (!texto){ toast("Cole o link do anúncio ou o texto da descrição primeiro.", true); return; }
    statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Lendo o anúncio com IA…</div>';
    try{
      const data = await extrairComIA(texto, draft.link_origem);
      aplicarDadosExtraidos(data);
      statusEl.innerHTML = '<div class="status-line" style="color:var(--success);">✓ Dados extraídos — confira e ajuste na etapa de Detalhes.</div>';
      toast("Dados extraídos com sucesso.");
      await persistDraft();
      setTimeout(()=>{ wizardStep = 1; renderWizard(); }, 550);
    }catch(err){
      statusEl.innerHTML = '<div class="status-line" style="color:var(--red);">'+escapeHtml(err.message || "Não foi possível extrair automaticamente. Preencha manualmente.")+'</div>';
    }
  });

  wizardNav(panel, {
    backLabel:"Cancelar", nextLabel:"Ir para os Detalhes →",
    onBack: ()=>{ setView("dashboard"); renderDashboard(); },
    onNext: async ()=>{ await persistDraft(); wizardStep=1; renderWizard(); }
  });
}

/* ---- Etapa 3: Capa ---- */
function renderStepCapa(panel){
  panel.innerHTML =
    '<h3 style="margin-bottom:6px;">Capa do feed e do story</h3>'+
    '<p style="color:var(--text-muted);font-size:.87rem;margin-bottom:18px;">Envie a foto principal do imóvel — o Seu Lugar Publicador monta as duas capas automaticamente com preço, bairro e características.</p>'+
    '<label class="upload-box" for="fotoCapaInput">'+
      '<input type="file" id="fotoCapaInput" accept="image/*">'+
      '<div class="icon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
      '<p>'+(capaFotoObj || draft.foto_principal_url ? "Trocar foto principal" : "Enviar foto principal")+'</p>'+
      '<div class="hint">JPG ou PNG, de preferência na vertical</div>'+
    '</label>'+
    '<div id="capaGenArea"></div>';

  const genArea = panel.querySelector("#capaGenArea");
  function renderGenButton(){
    genArea.innerHTML = '<div class="gen-cta-panel compact-capa">'+
        '<button class="btn btn-primary btn-sm" id="btnGerarCapas">🎨 Gerar capas do feed e do story</button>'+
        '<span class="gen-hint">Monta as duas versões (feed 1080×1350 e story 1080×1920) com preço, bairro e características já aplicados.</span>'+
        '<div id="capaStatus"></div>'+
      '</div>';
    genArea.querySelector("#btnGerarCapas").addEventListener("click", gerarCapas);
  }
  if (draft.capa_feed_url && draft.capa_story_url && !capaFotoObj){
    genArea.innerHTML =
      '<div class="preview-grid">'+
        '<div class="preview-card"><div class="label">Feed (1080×1350)</div><img src="'+draft.capa_feed_url+'"></div>'+
        '<div class="preview-card"><div class="label">Story (1080×1920)</div><img src="'+draft.capa_story_url+'"></div>'+
      '</div>'+
      '<div style="margin-top:16px;"><button class="btn btn-ghost btn-sm" id="btnRegen">Gerar novamente</button></div>';
    genArea.querySelector("#btnRegen").addEventListener("click", renderGenButton);
  } else {
    renderGenButton();
  }

  panel.querySelector("#fotoCapaInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    revogarUrlSeTemporaria(capaFotoObj && capaFotoObj.url);
    capaFotoObj = await loadImageFromFile(file);
    renderGenButton();
    toast("Foto carregada — clique em Gerar capas.");
  });

  async function gerarCapas(){
    if (!capaFotoObj){ toast("Envie a foto principal primeiro.", true); return; }
    const statusEl = genArea.querySelector("#capaStatus");
    statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Montando as capas…</div>';
    try{
      const [feedCanvas, storyCanvas] = await Promise.all([
        composeCapa("feed", capaFotoObj.img, draft, cfg),
        composeCapa("story", capaFotoObj.img, draft, cfg)
      ]);
      genArea.innerHTML = '<div class="preview-grid">'+
        '<div class="preview-card"><div class="label">Feed (1080×1350)</div></div>'+
        '<div class="preview-card"><div class="label">Story (1080×1920)</div></div>'+
      '</div>';
      const cards = genArea.querySelectorAll(".preview-card");
      cards[0].appendChild(feedCanvas);
      cards[1].appendChild(storyCanvas);
      const [feedBlob, storyBlob] = await Promise.all([canvasToBlob(feedCanvas), canvasToBlob(storyCanvas)]);
      const [feedAsset, storyAsset] = await Promise.all([
        AssetStore.uploadBlob(feedBlob),
        AssetStore.uploadBlob(storyBlob)
      ]);
      draft.capa_feed_url = feedAsset.url;
      draft.capa_story_url = storyAsset.url;
      draft.foto_principal_url = capaFotoObj.url;
      await persistDraft();
      const btnWrap = document.createElement("div");
      btnWrap.style.marginTop = "16px";
      btnWrap.innerHTML = '<button class="btn btn-ghost btn-sm" id="btnRegen2">Gerar novamente</button>';
      genArea.appendChild(btnWrap);
      btnWrap.querySelector("#btnRegen2").addEventListener("click", renderGenButton);
      toast("Capas geradas!");
    }catch(err){
      console.error(err);
      const statusEl2 = genArea.querySelector("#capaStatus");
      if (statusEl2) statusEl2.innerHTML = '<div class="status-line" style="color:var(--red);">'+escapeHtml(err.message||"Não foi possível gerar as capas.")+'</div>';
    }
  }

  wizardNav(panel, {
    onBack: ()=>{ wizardStep=1; renderWizard(); },
    onNext: async ()=>{
      if (!draft.capa_feed_url){ toast("Gere as capas antes de continuar.", true); return; }
      await persistDraft(); wizardStep=3; renderWizard();
    }
  });
}

/* ---- Etapa 4: Carrossel ---- */
function renderStepCarrossel(panel){
  const arrastarDisponivel = typeof Sortable !== "undefined";
  panel.innerHTML =
    '<h3 style="margin-bottom:6px;">Carrossel de fotos</h3>'+
    '<p style="color:var(--text-muted);font-size:.87rem;margin-bottom:18px;">Envie as fotos do imóvel — depois é só '+(arrastarDisponivel ? "arrastar cada uma para a ordem certa" : "usar as setas para reordenar")+'. Um slide final de chamada para ação é adicionado automaticamente.</p>'+
    '<label class="upload-box" for="fotosCarrosselInput">'+
      '<input type="file" id="fotosCarrosselInput" accept="image/*" multiple>'+
      '<div class="icon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 16l4.5-4.5a2 2 0 0 1 2.8 0L15 15m0 0l1.5-1.5a2 2 0 0 1 2.8 0L21 16M4 8h16M4 4h16v16H4V4z" stroke="currentColor" stroke-width="1.4"/></svg></div>'+
      '<p>Enviar fotos do carrossel</p>'+
      '<div class="hint">Pode selecionar várias fotos de uma vez</div>'+
    '</label>'+
    '<div class="thumb-strip" id="carrosselThumbs"></div>'+
    (arrastarDisponivel ? '<div class="drag-hint">↕️ Arraste as fotos para colocar na ordem certa.</div>' : '')+
    '<div class="field" style="margin-top:20px;display:flex;flex-direction:row;align-items:center;gap:10px;">'+
      '<input type="checkbox" id="fCTA" '+(draft.incluir_slide_cta!==false ? "checked":"")+' style="width:auto;">'+
      '<label style="margin:0;" for="fCTA">Incluir slide final "'+escapeHtml(cfg.cta_final||'Comente "Alugar"')+'"</label>'+
    '</div>'+
    '<div class="gen-cta-panel">'+
      '<button class="btn btn-primary btn-block" id="btnGerarCarrossel">🎞️ Gerar carrossel completo</button>'+
      '<span class="gen-hint">Monta todos os slides na ordem acima, já com o slide de chamada para ação no final.</span>'+
      '<div id="carrosselStatus"></div>'+
    '</div>'+
    '<div class="thumb-strip" id="carrosselResultado"></div>';

  let sortableInstance = null;
  function renderThumbs(){
    const wrap = panel.querySelector("#carrosselThumbs");
    wrap.innerHTML = "";
    carrosselFotos.forEach((f,i)=>{
      const el = document.createElement("div");
      el.className = "thumb-item";
      el.innerHTML = '<img src="'+f.url+'"><span class="ord">'+(i+1)+'</span><button class="rm" data-i="'+i+'">✕</button>'+
        (arrastarDisponivel ? '<span class="drag-handle">⠿ arraste</span>' : '<div class="mv"><button data-mv="up" data-i="'+i+'">↑</button><button data-mv="down" data-i="'+i+'">↓</button></div>');
      wrap.appendChild(el);
    });
    wrap.querySelectorAll(".rm").forEach(b=> b.addEventListener("click", ()=>{
      const i = Number(b.dataset.i);
      revogarUrlSeTemporaria(carrosselFotos[i] && carrosselFotos[i].url);
      carrosselFotos.splice(i,1);
      renderThumbs();
    }));
    wrap.querySelectorAll("[data-mv]").forEach(b=> b.addEventListener("click", ()=>{
      const i = Number(b.dataset.i), dir = b.dataset.mv==="up" ? -1 : 1, j = i+dir;
      if (j<0 || j>=carrosselFotos.length) return;
      [carrosselFotos[i], carrosselFotos[j]] = [carrosselFotos[j], carrosselFotos[i]];
      renderThumbs();
    }));
    if (arrastarDisponivel && !sortableInstance){
      sortableInstance = Sortable.create(wrap, {
        animation:150,
        filter:".rm",
        preventOnFilter:true,
        onEnd(evt){
          if (evt.oldIndex===evt.newIndex || evt.oldIndex==null || evt.newIndex==null) return;
          const moved = carrosselFotos.splice(evt.oldIndex,1)[0];
          carrosselFotos.splice(evt.newIndex,0,moved);
          renderThumbs();
        }
      });
    }
  }
  renderThumbs();

  panel.querySelector("#fotosCarrosselInput").addEventListener("change", async (e)=>{
    const files = Array.from(e.target.files||[]);
    if (!files.length) return;
    const objs = await Promise.all(files.map(loadImageFromFile));
    carrosselFotos.push(...objs);
    renderThumbs();
  });
  panel.querySelector("#fCTA").addEventListener("change", e=> draft.incluir_slide_cta = e.target.checked);

  panel.querySelector("#btnGerarCarrossel").addEventListener("click", async ()=>{
    if (!carrosselFotos.length){ toast("Envie pelo menos uma foto.", true); return; }
    const statusEl = panel.querySelector("#carrosselStatus");
    const resultWrap = panel.querySelector("#carrosselResultado");
    statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Montando os slides…</div>';
    resultWrap.innerHTML = "";
    try{
      const total = carrosselFotos.length + (draft.incluir_slide_cta!==false ? 1 : 0);
      const tarefasFotos = carrosselFotos.map((foto, i)=> (async ()=>{
        const canvas = await composeCarouselSlide(foto.img, Object.assign({marca:cfg.nome_marca}, draft), i, total, cfg);
        const blob = await canvasToBlob(canvas);
        const asset = await AssetStore.uploadBlob(blob);
        return {url:asset.url};
      })());
      const tarefaCta = draft.incluir_slide_cta!==false ? (async ()=>{
        const canvas = await composeCTASlide(draft, cfg);
        const blob = await canvasToBlob(canvas);
        const asset = await AssetStore.uploadBlob(blob);
        return {url:asset.url};
      })() : null;
      const uploaded = await Promise.all(tarefasFotos);
      if (tarefaCta) uploaded.push(await tarefaCta);
      resultWrap.innerHTML = "";
      uploaded.forEach((u,i)=>{
        const t = document.createElement("div"); t.className="thumb-item";
        t.innerHTML = '<img src="'+u.url+'"><span class="ord">'+(i+1)+'</span>';
        resultWrap.appendChild(t);
      });
      draft.fotos_carrossel = uploaded;
      await persistDraft();
      statusEl.innerHTML = '<div class="status-line" style="color:var(--success);">✓ Carrossel com '+total+' slides gerado.</div>';
      toast("Carrossel gerado!");
    }catch(err){
      console.error(err);
      statusEl.innerHTML = '<div class="status-line" style="color:var(--red);">'+escapeHtml(err.message||"Não foi possível gerar o carrossel.")+'</div>';
    }
  });

  wizardNav(panel, {
    onBack: ()=>{ wizardStep=2; renderWizard(); },
    onNext: async ()=>{
      if (!draft.fotos_carrossel || !draft.fotos_carrossel.length){ toast("Gere o carrossel antes de continuar.", true); return; }
      draft.status = "pronto";
      await persistDraft(); wizardStep=4; renderWizard();
    }
  });
}

/* ---- Etapa 2: Detalhes ---- */
function renderStepDetalhes(panel){
  panel.innerHTML =
    '<h3 style="margin-bottom:6px;">Confira os detalhes</h3>'+
    '<p style="color:var(--text-muted);font-size:.87rem;margin-bottom:18px;">Revise (ou preencha) as informações do imóvel — elas são usadas para montar a capa, o carrossel e a legenda a seguir.</p>'+
    '<div class="row2">'+
      '<div class="field"><label>Tipo do imóvel</label><select id="dTipo"></select></div>'+
      '<div class="field"><label>Código do imóvel</label><input type="text" id="dCodigo" value="'+escapeHtml(draft.codigo_unico)+'"></div>'+
    '</div>'+
    '<div class="row2">'+
      '<div class="field"><label>Bairro</label><input type="text" id="dBairro" value="'+escapeHtml(draft.bairro)+'"></div>'+
      '<div class="field"><label>Cidade/UF</label><input type="text" id="dCidade" value="'+escapeHtml(draft.cidade_estado)+'"></div>'+
    '</div>'+
    '<div class="field"><label>Link do anúncio (opcional)</label><input type="text" id="dLink" value="'+escapeHtml(draft.link_origem)+'" placeholder="https://..."></div>'+
    '<div class="row4">'+
      '<div class="field"><label>Quartos</label><input type="number" min="0" id="dQuartos" value="'+(draft.numero_quartos||0)+'"></div>'+
      '<div class="field"><label>Banheiros</label><input type="number" min="0" id="dBanheiros" value="'+(draft.numero_banheiros||0)+'"></div>'+
      '<div class="field"><label>Vagas</label><input type="number" min="0" id="dVagas" value="'+(draft.numero_vagas||0)+'"></div>'+
      '<div class="field"><label>Cozinhas</label><input type="number" min="0" id="dCozinhas" value="'+(draft.numero_cozinhas||0)+'"></div>'+
    '</div>'+
    '<div class="row2">'+
      '<div class="field"><label>Metragem (m²)</label><input type="number" min="0" id="dMetragem" value="'+(draft.metragem||0)+'"></div>'+
      '<div class="field"><label>Valor do aluguel (R$)</label><input type="number" min="0" step="0.01" id="dAluguel" value="'+(draft.valor_aluguel||0)+'"></div>'+
    '</div>'+
    '<div class="row2">'+
      '<div class="field"><label>Condomínio (R$)</label><input type="number" min="0" step="0.01" id="dCondominio" value="'+(draft.valor_condominio||0)+'"></div>'+
      '<div class="field"><label>IPTU (R$)</label><input type="number" min="0" step="0.01" id="dIptu" value="'+(draft.valor_iptu||0)+'"></div>'+
    '</div>';

  const sel = panel.querySelector("#dTipo");
  TIPOS_IMOVEL.forEach(t=>{
    const o = document.createElement("option"); o.value=t; o.textContent=t;
    if (t===draft.tipo_imovel) o.selected = true;
    sel.appendChild(o);
  });
  if (!TIPOS_IMOVEL.includes(draft.tipo_imovel)){
    const o = document.createElement("option"); o.value=draft.tipo_imovel; o.textContent=draft.tipo_imovel; o.selected=true;
    sel.appendChild(o);
  }

  function bind(id, field, isNum){
    panel.querySelector(id).addEventListener("input", e=>{
      draft[field] = isNum ? (parseFloat(e.target.value)||0) : e.target.value;
    });
  }
  bind("#dTipo","tipo_imovel"); bind("#dCodigo","codigo_unico"); bind("#dBairro","bairro"); bind("#dCidade","cidade_estado"); bind("#dLink","link_origem");
  bind("#dQuartos","numero_quartos",true); bind("#dBanheiros","numero_banheiros",true); bind("#dVagas","numero_vagas",true); bind("#dCozinhas","numero_cozinhas",true);
  bind("#dMetragem","metragem",true); bind("#dAluguel","valor_aluguel",true); bind("#dCondominio","valor_condominio",true); bind("#dIptu","valor_iptu",true);

  wizardNav(panel, {
    onBack: ()=>{ wizardStep=0; renderWizard(); },
    onNext: async ()=>{
      if (!draft.bairro){ toast("Informe o bairro do imóvel.", true); return; }
      await persistDraft();
      wizardStep=2; renderWizard();
    }
  });
}

/* ---- Etapa 5: Publicar ---- */
function renderStepPublicar(panel){
  if (!draft.legenda){
    draft.legenda = buildLegenda(draft, cfg.legenda_template);
  }
  if (!draft.hashtags_selecionadas || !draft.hashtags_selecionadas.length){
    draft.hashtags_selecionadas = (cfg.pool_hashtags||[]).slice(0, cfg.max_hashtags_por_post||15);
  }
  panel.innerHTML =
    '<h3 style="margin-bottom:6px;">Legenda e download</h3>'+
    '<p style="color:var(--text-muted);font-size:.87rem;margin-bottom:18px;">Ajuste a legenda e as hashtags, e baixe tudo pronto para postar no Instagram.</p>'+
    '<div class="field"><label>Legenda</label><textarea id="pLegenda" rows="10">'+escapeHtml(draft.legenda)+'</textarea></div>'+
    '<div class="field"><label>Hashtags (máx. '+(cfg.max_hashtags_por_post||15)+') <span class="hint" id="hCount"></span></label>'+
      '<div class="hashtag-grid" id="hashtagGrid"></div>'+
    '</div>'+
    '<div class="field"><label>Prévia final da legenda</label><div class="caption-box" id="captionPreview"></div></div>'+
    '<div class="panel" id="igPanel" style="margin-top:24px;background:var(--surface-2);">'+
      '<div class="ig-panel-head">'+
        '<div class="ig-panel-icon">📸</div>'+
        '<div><h3 style="margin-bottom:2px;">Publicar no Instagram</h3>'+
        '<p style="color:var(--text-muted);font-size:.85rem;">Publica a capa do feed e as fotos do carrossel juntas, num único post, direto na conta da imobiliária.</p></div>'+
      '</div>'+
      '<div id="igBody" class="ig-body"></div>'+
    '</div>'+
    '<div class="checklist" id="checklistFinal" style="margin-top:20px;"></div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:28px;padding-top:20px;border-top:1px solid var(--border);">'+
      '<button class="btn btn-primary" id="btnBaixarTudo">⬇️ Baixar tudo (.zip)</button>'+
    '</div>'+
    '<div id="publicarStatus"></div>';

  panel.querySelector("#pLegenda").addEventListener("input", e=>{ draft.legenda = e.target.value; updatePreview(); });

  const grid = panel.querySelector("#hashtagGrid");
  function renderHashtags(){
    grid.innerHTML = "";
    (cfg.pool_hashtags||[]).forEach(tag=>{
      const on = draft.hashtags_selecionadas.includes(tag);
      const el = document.createElement("label");
      el.className = "htag"+(on?" on":"");
      el.innerHTML = '<input type="checkbox" '+(on?"checked":"")+'>'+tag;
      el.querySelector("input").addEventListener("change", (e)=>{
        const max = cfg.max_hashtags_por_post||15;
        if (e.target.checked){
          if (draft.hashtags_selecionadas.length >= max){ e.target.checked=false; toast("Máximo de "+max+" hashtags.", true); return; }
          draft.hashtags_selecionadas.push(tag);
        } else {
          draft.hashtags_selecionadas = draft.hashtags_selecionadas.filter(t=>t!==tag);
        }
        renderHashtags(); updatePreview();
      });
      grid.appendChild(el);
    });
    panel.querySelector("#hCount").textContent = "("+draft.hashtags_selecionadas.length+" selecionadas)";
  }
  function updatePreview(){
    panel.querySelector("#captionPreview").textContent = draft.legenda + "\n\n" + draft.hashtags_selecionadas.join(" ");
  }
  renderHashtags(); updatePreview();

  function renderChecklist(){
    const items = [
      {ok: !!draft.capa_feed_url, label:"Capa do feed gerada"},
      {ok: !!draft.capa_story_url, label:"Capa do story gerada"},
      {ok: !!(draft.fotos_carrossel && draft.fotos_carrossel.length), label:"Carrossel montado ("+((draft.fotos_carrossel||[]).length)+" slides)"},
      {ok: !!draft.bairro, label:"Detalhes do imóvel preenchidos"},
      {ok: draft.hashtags_selecionadas.length>0, label:"Hashtags selecionadas"},
      {ok: draft.instagram_status==="publicado", label:"Publicado no Instagram"}
    ];
    panel.querySelector("#checklistFinal").innerHTML = items.map(it=>
      '<div class="item"><span class="dot'+(it.ok?"":" pending")+'"></span>'+it.label+'</div>'
    ).join("");
  }
  renderChecklist();

  /* ---- Publicar no Instagram (de verdade, via Instagram Graph API no backend) ---- */
  const igBody = panel.querySelector("#igBody");
  function coletarMidiasParaPublicar(){
    const midias = [];
    if (draft.capa_feed_url) midias.push(draft.capa_feed_url);
    (draft.fotos_carrossel||[]).forEach(f=>{ if (f && f.url) midias.push(f.url); });
    return midias;
  }
  function renderIgBody(){
    if (!cfg.instagram_access_token_configurado || !cfg.instagram_business_account_id){
      igBody.innerHTML = '<div class="ig-badge ig-badge-pending">Não configurado</div><p class="hint" style="margin-top:10px;">Configure o token de acesso e o ID da conta do Instagram em <b>Configurações</b> para habilitar a publicação automática.</p>';
      return;
    }
    if (!draft.capa_feed_url){
      igBody.innerHTML = '<div class="ig-badge ig-badge-pending">Aguardando capa</div><p class="hint" style="margin-top:10px;">Gere a capa do feed (etapa <b>Capa</b>) antes de publicar.</p>';
      return;
    }
    const st = draft.instagram_status || "nenhum";
    if (st === "publicado"){
      igBody.innerHTML =
        '<div class="ig-badge ig-badge-success">✓ Publicado'+(draft.instagram_publicado_em?(" — "+fmtDataCurta(draft.instagram_publicado_em)):"")+'</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">'+
          (draft.instagram_permalink ? '<a href="'+escapeHtml(draft.instagram_permalink)+'" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Ver post no Instagram ↗</a>' : '')+
          '<button class="btn btn-ghost btn-sm" id="btnIgRepublicar">Publicar novamente</button>'+
        '</div>';
      igBody.querySelector("#btnIgRepublicar").addEventListener("click", solicitarPublicacaoIg);
      return;
    }
    if (st === "publicando"){
      igBody.innerHTML = '<div class="ig-badge ig-badge-pending"><div class="spinner"></div>Publicando…</div><p class="hint" style="margin-top:10px;">Isso pode levar até um minuto -- a Meta processa as imagens antes de publicar.</p>';
      return;
    }
    if (st === "erro"){
      igBody.innerHTML =
        '<div class="ig-badge ig-badge-error">⚠️ Erro ao publicar</div>'+
        '<p class="hint" style="margin-top:10px;">'+escapeHtml(draft.instagram_erro_msg||"Não foi possível publicar.")+'</p>'+
        '<div style="margin-top:10px;"><button class="btn btn-primary btn-sm" id="btnIgTentar">Tentar novamente</button></div>';
      igBody.querySelector("#btnIgTentar").addEventListener("click", solicitarPublicacaoIg);
      return;
    }
    const totalMidias = coletarMidiasParaPublicar().length;
    const excedeuLimite = totalMidias > 10;
    igBody.innerHTML =
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">'+
        '<img src="'+draft.capa_feed_url+'" alt="" class="ig-photo-preview">'+
        '<div style="flex:1;min-width:200px;">'+
          '<div class="ig-badge '+(excedeuLimite?"ig-badge-warn":"ig-badge-pending")+'" style="margin-bottom:8px;">'+(excedeuLimite?"Limite de fotos excedido":"Pronto para publicar")+'</div>'+
          '<button class="btn btn-primary" id="btnIgPublicar"'+(excedeuLimite?" disabled":"")+'>📸 Publicar no Instagram agora</button>'+
          (excedeuLimite
            ? '<div class="hint" style="margin-top:6px;color:var(--red);">Este imóvel tem '+totalMidias+' fotos (capa + carrossel) — o Instagram aceita no máximo 10 por publicação. Remova algumas fotos na etapa Carrossel e gere novamente.</div>'
            : '<div class="hint" style="margin-top:6px;">Vai para @'+escapeHtml(cfg.instagram_username||"")+' como um carrossel de '+totalMidias+' foto(s), com a legenda acima.</div>')+
        '</div>'+
      '</div>';
    const btn = igBody.querySelector("#btnIgPublicar");
    if (btn) btn.addEventListener("click", solicitarPublicacaoIg);
  }
  async function solicitarPublicacaoIg(){
    const totalMidias = coletarMidiasParaPublicar().length;
    const ok = await confirmModal(
      "Publicar no Instagram?",
      "Isso publica agora, de forma pública, na conta @"+(cfg.instagram_username||"")+" — um carrossel com "+totalMidias+" foto(s) (capa + carrossel) e a legenda desta tela.",
      "Publicar agora"
    );
    if (!ok) return;
    // Salva o estado atual (legenda/hashtags podem ter sido editadas nesta
    // tela) antes de publicar -- o backend publica o que está gravado no
    // banco, não o que está só na tela.
    await persistDraft({ instagram_status: "publicando", instagram_erro_msg: "" });
    renderIgBody();
    try{
      const atualizado = await Store.publicarInstagram(draftId);
      Object.assign(draft, atualizado);
      toast("Publicado no Instagram!");
    }catch(err){
      draft.instagram_status = "erro";
      draft.instagram_erro_msg = err.message || "Não foi possível publicar.";
      toast("Não foi possível publicar — veja o erro abaixo.", true);
    }
    renderChecklist();
    renderIgBody();
  }
  renderIgBody();

  panel.querySelector("#btnBaixarTudo").addEventListener("click", async ()=>{
    const statusEl = panel.querySelector("#publicarStatus");
    if (typeof JSZip === "undefined"){ toast("Não foi possível carregar o compactador de arquivos.", true); return; }
    statusEl.innerHTML = '<div class="status-line"><div class="spinner"></div>Preparando o arquivo .zip…</div>';
    try{
      const zip = new JSZip();
      const codigo = (draft.codigo_unico || draft.bairro || "imovel").replace(/[^a-z0-9]+/gi,"_").toLowerCase();
      async function addImageFromUrl(url, name){
        if (!url) return;
        const resp = await fetch(url);
        const blob = await resp.blob();
        zip.file(name, blob);
      }
      const slides = draft.fotos_carrossel||[];
      await Promise.all([
        addImageFromUrl(draft.capa_feed_url, "01_capa_feed.png"),
        addImageFromUrl(draft.capa_story_url, "02_capa_story.png"),
        ...slides.map((s,i)=> addImageFromUrl(s.url, "03_carrossel_"+String(i+1).padStart(2,"0")+".png"))
      ]);
      const finalCaption = draft.legenda + "\n\n" + draft.hashtags_selecionadas.join(" ");
      zip.file("legenda.txt", finalCaption);
      const zipBlob = await zip.generateAsync({type:"blob"});
      downloadBlob(zipBlob, "seulugar_"+codigo+".zip");
      draft.status = "baixado";
      await persistDraft();
      statusEl.innerHTML = '<div class="status-line" style="color:var(--success);">✓ Arquivo baixado — pronto para publicar manualmente no Instagram.</div>';
      toast("Download concluído!");
    }catch(err){
      console.error(err);
      statusEl.innerHTML = '<div class="status-line" style="color:var(--red);">'+escapeHtml(err.message||"Não foi possível gerar o download.")+'</div>';
    }
  });

  wizardNav(panel, {
    backLabel:"Voltar", nextLabel:"Concluir e voltar",
    onBack: ()=>{ wizardStep=3; renderWizard(); },
    onNext: async ()=>{ await persistDraft(); setView("dashboard"); renderDashboard(); }
  });
}

/* ============================================================
   CONFIG VIEW
   ============================================================ */
function renderConfig(){
  const body = document.getElementById("configBody");
  if (!isAdmin){
    body.innerHTML = '<div class="empty-state"><h3>Só administradores</h3><p>Peça para um administrador da imobiliária mexer nas configurações do Publicador.</p></div>';
    return;
  }
  body.innerHTML =
    '<div class="panel" style="margin-bottom:20px;">'+
      '<h3 style="margin-bottom:16px;">Marca</h3>'+
      '<div class="row2">'+
        '<div class="field"><label>Nome da marca</label><input type="text" id="cNome" value="'+escapeHtml(cfg.nome_marca)+'"></div>'+
        '<div class="field"><label>Slogan</label><input type="text" id="cSlogan" value="'+escapeHtml(cfg.slogan)+'"></div>'+
      '</div>'+
      '<div class="row2">'+
        '<div class="field"><label>Cidade/UF padrão</label><input type="text" id="cCidade" value="'+escapeHtml(cfg.cidade_estado)+'"></div>'+
        '<div class="field"><label>Usuário do Instagram (referência)</label><input type="text" id="cIgUser" value="'+escapeHtml(cfg.instagram_username||"")+'" placeholder="ex: imobiliariaseulugar"></div>'+
      '</div>'+
      '<div class="field"><label>Texto do slide final (CTA)</label><input type="text" id="cCTA" value="'+escapeHtml(cfg.cta_final)+'"></div>'+
      '<label style="font-size:.8rem;font-weight:600;color:var(--text-muted);">Cores</label>'+
      '<div class="color-row" style="margin-top:8px;">'+
        '<div class="color-field"><input type="color" id="cCorVermelho" value="'+cfg.cor_vermelho+'"><span class="hint">Destaque</span></div>'+
        '<div class="color-field"><input type="color" id="cCorPreto" value="'+cfg.cor_preto+'"><span class="hint">Escuro</span></div>'+
        '<div class="color-field"><input type="color" id="cCorBranco" value="'+cfg.cor_branco+'"><span class="hint">Claro</span></div>'+
      '</div>'+
      '<label style="font-size:.8rem;font-weight:600;color:var(--text-muted);display:block;margin-top:18px;">Logo (opcional)</label>'+
      '<p class="hint" style="margin:4px 0 10px;">Se você enviar um logo, ele substitui o nome da marca escrito em texto na caixinha da capa.</p>'+
      '<div id="logoPreviewWrap" style="margin-bottom:10px;">'+
        (cfg.logo_url
          ? '<img src="'+cfg.logo_url+'" alt="Logo atual" style="max-height:60px;max-width:220px;border:1px solid var(--border);border-radius:8px;padding:6px;background:#fff;display:block;">'
          : '<span class="hint">Nenhum logo enviado ainda -- a capa usa o nome da marca em texto.</span>')+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'+
        '<label class="btn btn-ghost btn-sm" for="cLogoInput" style="cursor:pointer;">'+(cfg.logo_url?"Trocar logo":"Enviar logo")+'</label>'+
        '<input type="file" id="cLogoInput" accept="image/*" style="display:none;">'+
        (cfg.logo_url ? '<button class="btn btn-ghost btn-sm" id="cLogoRemove" type="button">Remover logo</button>' : '')+
        '<span id="logoUploadStatus" class="hint"></span>'+
      '</div>'+
    '</div>'+
    '<div class="panel" style="margin-bottom:20px;">'+
      '<h3 style="margin-bottom:10px;">Armazenamento das imagens (Cloudinary)</h3>'+
      '<p class="hint" style="margin-bottom:14px;">As capas e o carrossel gerados aqui precisam ficar guardados num link público -- preencha os dois campos abaixo com uma conta <b>gratuita</b> do Cloudinary (cloudinary.com).</p>'+
      '<div class="row2">'+
        '<div class="field"><label>Cloudinary — Cloud name</label><input type="text" id="cCloudName" value="'+escapeHtml(cfg.cloudinary_cloud_name||"")+'" placeholder="ex: seulugar-imoveis"></div>'+
        '<div class="field"><label>Cloudinary — Upload preset (não assinado)</label><input type="text" id="cCloudPreset" value="'+escapeHtml(cfg.cloudinary_upload_preset||"")+'" placeholder="ex: seulugar_unsigned"></div>'+
      '</div>'+
      '<p class="hint">Como configurar (uma vez só, ~5 min): crie uma conta gratuita em cloudinary.com → o "Cloud name" aparece no painel principal → em Settings → Upload → "Upload presets", crie um preset novo com "Signing Mode: Unsigned" e copie o nome dele aqui. Nenhuma senha ou chave secreta é necessária nem armazenada aqui.</p>'+
    '</div>'+
    '<div class="panel" style="margin-bottom:20px;">'+
      '<h3 style="margin-bottom:10px;">Publicar automaticamente no Instagram</h3>'+
      '<p class="hint" style="margin-bottom:14px;">Preencha os dois campos abaixo (vem de uma conta de desenvolvedor Meta) para habilitar o botão "Publicar no Instagram agora" na última etapa de cada imóvel.</p>'+
      '<div class="row2">'+
        '<div class="field"><label>ID da conta comercial do Instagram</label><input type="text" id="cIgBizId" value="'+escapeHtml(cfg.instagram_business_account_id||"")+'" placeholder="ex: 17841400000000000"></div>'+
        '<div class="field"><label>Token de acesso (Page Access Token)</label><input type="password" id="cIgToken" value="" placeholder="'+(cfg.instagram_access_token_configurado ? "•••••••• (já configurado -- deixe em branco pra manter)" : "cole o token aqui")+'"></div>'+
      '</div>'+
      '<p class="hint" id="cIgTokenStatus">'+(
        cfg.instagram_access_token_configurado
          ? "✓ Token configurado" + (cfg.instagram_access_token_updated_at ? " -- renovado pela última vez em "+fmtDataCurta(cfg.instagram_access_token_updated_at)+" (o sistema renova sozinho a cada ~45 dias, sem precisar mexer aqui)." : ".")
          : "Nenhum token configurado ainda."
      )+'</p>'+
    '</div>'+
    '<div class="panel" style="margin-bottom:20px;">'+
      '<h3 style="margin-bottom:10px;">Modelo de legenda</h3>'+
      '<p class="hint" style="margin-bottom:10px;">Use as variáveis: {tipo_imovel} {bairro} {codigo_unico} {numero_quartos} {numero_banheiros} {numero_vagas} {numero_cozinhas} {metragem} {valor_aluguel} {valor_condominio} {valor_iptu}</p>'+
      '<div class="field"><textarea id="cTemplate" rows="10">'+escapeHtml(cfg.legenda_template)+'</textarea></div>'+
    '</div>'+
    '<div class="panel" style="margin-bottom:20px;">'+
      '<h3 style="margin-bottom:10px;">Banco de hashtags</h3>'+
      '<div class="field"><label>Máximo de hashtags por publicação</label><input type="number" min="1" max="30" id="cMaxHashtags" value="'+cfg.max_hashtags_por_post+'" style="max-width:120px;"></div>'+
      '<div class="hashtag-grid" id="cHashtagList"></div>'+
      '<div class="chip-input-row"><input type="text" id="cNovaHashtag" placeholder="#NovaHashtag"><button class="btn btn-ghost btn-sm" id="cAddHashtag">Adicionar</button></div>'+
    '</div>'+
    '<button class="btn btn-primary btn-block" id="btnSalvarConfig">Salvar configurações</button>'+
    '<div id="configStatus"></div>';

  const logoInput = body.querySelector("#cLogoInput");
  if (logoInput){
    logoInput.addEventListener("change", async (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = body.querySelector("#logoUploadStatus");
      statusEl.textContent = "Enviando…";
      try{
        const asset = await AssetStore.uploadBlob(file);
        cfg.logo_url = asset.url;
        await Store.saveConfig(cfg);
        toast("Logo enviado e salvo.");
        renderConfig();
      }catch(err){
        statusEl.textContent = "";
        toast(err.message || "Não foi possível enviar o logo.", true);
      }
    });
  }
  const logoRemoveBtn = body.querySelector("#cLogoRemove");
  if (logoRemoveBtn){
    logoRemoveBtn.addEventListener("click", async ()=>{
      cfg.logo_url = "";
      await Store.saveConfig(cfg);
      toast("Logo removido -- a capa volta a usar o nome da marca em texto.");
      renderConfig();
    });
  }

  function renderHashtagList(){
    const wrap = body.querySelector("#cHashtagList");
    wrap.innerHTML = "";
    cfg.pool_hashtags.forEach((tag,i)=>{
      const el = document.createElement("span");
      el.className = "htag on";
      el.innerHTML = tag+' <button style="background:none;border:none;color:#fff;cursor:pointer;font-weight:700;" data-i="'+i+'">✕</button>';
      el.querySelector("button").addEventListener("click", ()=>{ cfg.pool_hashtags.splice(i,1); renderHashtagList(); });
      wrap.appendChild(el);
    });
  }
  renderHashtagList();
  body.querySelector("#cAddHashtag").addEventListener("click", ()=>{
    const input = body.querySelector("#cNovaHashtag");
    let val = input.value.trim();
    if (!val) return;
    if (!val.startsWith("#")) val = "#"+val;
    val = val.replace(/\s+/g,"");
    if (!cfg.pool_hashtags.includes(val)) cfg.pool_hashtags.push(val);
    input.value = "";
    renderHashtagList();
  });

  body.querySelector("#btnSalvarConfig").addEventListener("click", async ()=>{
    cfg.nome_marca = body.querySelector("#cNome").value;
    cfg.slogan = body.querySelector("#cSlogan").value;
    cfg.cidade_estado = body.querySelector("#cCidade").value;
    cfg.instagram_username = body.querySelector("#cIgUser").value.trim();
    cfg.cta_final = body.querySelector("#cCTA").value;
    cfg.cor_vermelho = body.querySelector("#cCorVermelho").value;
    cfg.cor_preto = body.querySelector("#cCorPreto").value;
    cfg.cor_branco = body.querySelector("#cCorBranco").value;
    cfg.legenda_template = body.querySelector("#cTemplate").value;
    cfg.max_hashtags_por_post = parseInt(body.querySelector("#cMaxHashtags").value,10) || 15;
    cfg.cloudinary_cloud_name = body.querySelector("#cCloudName").value.trim();
    cfg.cloudinary_upload_preset = body.querySelector("#cCloudPreset").value.trim();
    cfg.instagram_business_account_id = body.querySelector("#cIgBizId").value.trim();
    // Campo sempre em branco por padrão (o servidor nunca devolve o token
    // salvo) -- só sobrescreve se a pessoa digitou algo novo aqui.
    cfg.instagram_access_token = body.querySelector("#cIgToken").value.trim();
    const statusEl = body.querySelector("#configStatus");
    try{
      await Store.saveConfig(cfg);
      cfg = await Store.getConfig(); // recarrega para refletir o estado real do token (redigido) e demais campos
      renderConfig();
      body.querySelector("#configStatus").innerHTML = '<div class="status-line" style="color:var(--success);margin-top:12px;">✓ Configurações salvas.</div>';
      toast("Configurações salvas.");
    }catch(e){
      statusEl.innerHTML = '<div class="status-line" style="color:var(--red);margin-top:12px;">Não foi possível salvar: '+escapeHtml(e.message)+'</div>';
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */
let isAdmin = false;

async function boot(){
  // Exige login -- reaproveita a mesma sessão (cookie) do painel principal.
  let me;
  try{ me = await api("/api/auth/me"); }
  catch(e){ window.location.href = "index.html"; return; }
  isAdmin = me.user && me.user.role === "admin";
  // Só admin mexe em Configurações (token do Instagram, Cloudinary, IA...) --
  // membros continuam usando o resto do Publicador normalmente. O backend
  // também recusa a gravação para quem não é admin; isto aqui é só a tela
  // nem mostrar a opção pra quem não pode usá-la.
  if (!isAdmin){
    const btnConfig = document.querySelector('.tab-btn[data-view="config"]');
    if (btnConfig) btnConfig.hidden = true;
  }

  ensureFontsLoaded(); ensureIconsLoaded();
  try{ cfg = await Store.getConfig(); }catch(e){ cfg = Object.assign({}, DEFAULT_CONFIG); }
  renderDashboard();
  setView("dashboard");
}
boot();

})();
