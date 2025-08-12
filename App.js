// App.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Linking,
  Platform
} from 'react-native';
import { Video } from 'expo-av';
import { WebView } from 'react-native-webview';

const API_URL = 'http://91.108.124.236:8080/games/api';

// Finge ser Chrome Android (ajuda sites a entregarem o player certo)
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// CSS para o player preencher o quadro 16:9
const INJECT_CSS_RESP = `
  html, body { margin:0; padding:0; height:100%; background:#000; }
  /* ocupa todo o viewport do WebView */
  #fbx_host { position:fixed; inset:0; background:#000; }
  /* <video> direto na página */
  video {
    width:100% !important;
    height:100% !important;
    object-fit:contain !important;   /* sem cortes, com letterbox se precisar */
    background:#000 !important;
  }
  /* players dentro de iframe/embed */
  iframe, embed, object {
    position:absolute !important;
    top:0; left:0;
    width:100% !important;
    height:100% !important;
    background:#000 !important;
  }
`;

// JS: cria um contêiner “fullscreen” e move o primeiro vídeo/iframe pra dentro
const INJECT_JS_AUTOPLAY = `
  (function () {
    try {
      // wrapper que ocupa todo o WebView
      var host = document.getElementById('fbx_host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'fbx_host';
        document.body.appendChild(host);
      }

      // tenta achar player
      var el = document.querySelector('video, iframe, embed, object');
      if (el && host && el.parentNode !== host) host.appendChild(el);

      // habilita autoplay inline com áudio
      var vids = Array.from(document.querySelectorAll('video,audio'));
      vids.forEach(function(v){
        try {
          v.setAttribute('playsinline','');
          v.setAttribute('webkit-playsinline','');
          v.muted = false;
          var p = v.play();
          p && p.catch(function(){});
        } catch(e){}
      });

      // melhora iframes
      Array.from(document.querySelectorAll('iframe')).forEach(function(f){
        var allow = (f.getAttribute('allow')||'');
        if (!/autoplay/.test(allow)) {
          f.setAttribute('allow', (allow ? allow + ';' : '') + 'autoplay;encrypted-media');
        }
      });
    } catch (e) {}
    true;
  })();
`;

const AoVivo = ({ ativo }) => {
  const opacity = React.useRef(new Animated.Value(1)).current;
  const loopRef = React.useRef(null);

  React.useEffect(() => {
    if (ativo) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      // para e reseta quando não estiver ao vivo
      loopRef.current?.stop();
      opacity.setValue(1);
    }
    return () => loopRef.current?.stop();
  }, [ativo, opacity]);

  if (!ativo) return null;

  return (
    <View style={styles.liveRow}>
      <Animated.Text style={[styles.liveDot, { opacity }]}>•</Animated.Text>
      <Text style={styles.liveText}>ao vivo</Text>
    </View>
  );
};


function joinIf(a, b, sep = ' x ') {
const A = (a || '').trim();
const B = (b || '').trim();
if (A && B) return `${A}${sep}${B}`;
return A || B || '';
}

export default function App() {
const [data, setData] = useState([]);
const [busy, setBusy] = useState(true);
const [err, setErr] = useState('');
const [currentLink, setCurrentLink] = useState('');
const [mode, setMode] = useState(null);
const [expandedId, setExpandedId] = useState(null);
const playerRef = useRef(null);

const todayLabel = useMemo(() => {
const d = new Date();
const dd = String(d.getDate()).padStart(2, '0');
const mm = String(d.getMonth() + 1).padStart(2, '0');
return `${dd}/${mm}`;
}, []);

const detectMode = (url) =>
/\.m3u8(\?|$)/i.test(url || '') ? 'video' : 'web';

async function load() {
try {
setErr('');
setBusy(true);

// 🔁 Zera o estado ANTES de buscar (evita tocar o último canal)
setExpandedId(null);
setCurrentLink('');
setMode(null);

const r = await fetch(API_URL);
const j = await r.json();

setData(
(Array.isArray(j) ? j : []).filter(
x => x && (x.home_team || x.visiting_team || x.championship)
)
);

// ❌ Não auto-seleciona canal aqui
} catch (e) {
setErr('Falha ao carregar dados.');

// Em caso de erro, garante que não volte o último link
setExpandedId(null);
setCurrentLink('');
setMode(null);
} finally {
setBusy(false);
}
}

useEffect(() => {
load();
}, []);

const onSelectChannel = (url) => {
setCurrentLink(url);
setMode(detectMode(url));
};



const HeaderSticky = React.useCallback(() => (
  <View style={styles.stickyWrap}>
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Futanium Box 3.0</Text>
    </View>

    <View style={styles.playerBox}>
      {busy && !currentLink ? (
        <ActivityIndicator color="#fff" />
      ) : currentLink ? (
        mode === 'video' ? (
          <Video
            ref={playerRef}
            style={StyleSheet.absoluteFill}
            source={{ uri: currentLink }}
            resizeMode="contain"
            shouldPlay
            useNativeControls
            onReadyForDisplay={enforceBar}
            onPlaybackStatusUpdate={enforceBar}
          />
        ) : (
          <WebView
            source={{ uri: currentLink }}
            style={StyleSheet.absoluteFill}
            userAgent={CHROME_UA}
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            onLoadStart={enforceBar}
            onLoadEnd={enforceBar}
            injectedJavaScriptBeforeContentLoaded={INJECT_JS_AUTOPLAY}
            injectedJavaScript={`(function(){
              var s=document.createElement('style'); s.innerHTML=\`${INJECT_CSS_RESP}\`;
              document.head.appendChild(s); true;
            })();`}
            setSupportMultipleWindows={false}
          />
        )
      ) : (
        <Text style={styles.playerHint}>Selecione um jogo para reproduzir</Text>
      )}
    </View>

    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>JOGOS DE HOJE {todayLabel}</Text>
    </View>
  </View>
), [busy, currentLink, mode, todayLabel]);

const renderItem = ({ item, index }) => {
  // uid estável: usa id da API, senão o índice
  const uid = item?.id ?? index;

  const hasButtons = Array.isArray(item?.buttons) && item.buttons.length > 0;
  const expanded = expandedId === uid;

  return (
    <View style={styles.card}>
      {/* CARD INTEIRO CLICÁVEL (topo + linha do jogo) */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          // só alterna o expandir/fechar; NÃO mexe em currentLink
          setExpandedId(expanded ? null : uid);
        }}
      >
        {/* Campeonato + logo no topo */}
        <View style={styles.champRow}>
          {item.championship_image_url ? (
            <Image
              source={{ uri: item.championship_image_url }}
              style={styles.champLogo}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.champText}>{item.championship}</Text>
        </View>

        {/* Times e horário no centro */}
        <View style={styles.matchRow}>
          {/* TIME DA CASA */}
          <View style={styles.teamBlock}>
            <View style={styles.logoBox}>
              {item.home_team_image_url ? (
                <Image
                  source={{ uri: item.home_team_image_url }}
                  style={styles.teamLogo}
                  resizeMode="contain"
                />
              ) : null}
            </View>
            <Text style={styles.teamName} numberOfLines={2} ellipsizeMode="tail">
              {item.home_team}
            </Text>
          </View>

          <View style={styles.timeWrap}>
            <Text style={styles.timeText}>{item.start_time}</Text>
            <AoVivo ativo={item.is_live} />
          </View>

          {/* VISITANTE */}
          <View style={styles.teamBlock}>
            <View style={styles.logoBox}>
              {item.visiting_team_image_url ? (
                <Image
                  source={{ uri: item.visiting_team_image_url }}
                  style={styles.teamLogo}
                  resizeMode="contain"
                />
              ) : null}
            </View>
            <Text style={styles.teamName} numberOfLines={2} ellipsizeMode="tail">
              {item.visiting_team}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Botões – fora do Touchable do card */}
      {expanded && hasButtons && (
        <View style={styles.buttonsRow}>
          {item.buttons.map((b, i) => (
            <TouchableOpacity
              key={i}
              style={styles.playBtn}
              onPress={() => {
                // Agora sim troca o player, mas SEM fechar/abrir card
                onSelectChannel(b.url);
              }}
            >
              <Text style={styles.playBtnText}>{b.name || `Canal ${i + 1}`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};



// mantém a StatusBar sempre escura
const enforceBar = () => {
  if (Platform.OS === 'android') {
    StatusBar.setBackgroundColor('#151823', true); // mesma cor do header
    StatusBar.setTranslucent(false);
  }
  StatusBar.setBarStyle('light-content', true);
};

// ao montar
useEffect(() => {
  enforceBar();
}, []);

// e toda vez que trocar de link/mode (quando clica num botão de canal)
useEffect(() => {
  enforceBar();
}, [currentLink, mode]);

return (
  <SafeAreaView style={{ flex: 1, backgroundColor: '#151823' }}>
    <StatusBar barStyle="light-content" backgroundColor="#151823" />

    {err ? (
      <View style={styles.center}>
        <Text style={{ color: '#fff' }}>{err}</Text>
        <TouchableOpacity onPress={load} style={styles.reload}>
          <Text style={styles.reloadText}>Tentar novamente</Text>
        </TouchableOpacity>
      </View>
    ) : (
      <View style={{ flex: 1 }}>
        <HeaderSticky />
        <FlatList
          style={{ flex: 1 }}
          data={data}
          keyExtractor={(item, idx) => String(item?.id ?? idx)}
          renderItem={renderItem}
          contentContainerStyle={{
    paddingBottom: 24,
    backgroundColor: '#f5f5f5' // cinza claro do fundo
  }}
          refreshControl={
            <RefreshControl refreshing={busy} onRefresh={load} tintColor="#fff" />
          }
          bounces={false}
          overScrollMode="never"
        />
      </View>
    )}
  </SafeAreaView>
);

}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#151823' }, // cor da StatusBar e header // fundo geral cinza claro

  header: {
    paddingTop: (StatusBar.currentHeight || 0) + 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#151823',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2f3a',
  },

  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },

  playerBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    marginBottom: 12
  },

  playerHint: { 
    color: '#bbb', 
    textAlign: 'center', 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    textAlignVertical: 'center' 
  },

  sectionTitleWrap: {
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F3F3F3' // fundo igual ao fundo geral
  },

 stickyWrap: {
    backgroundColor: '#F3F3F3',
    zIndex: 10,
    elevation: 10
  },

  
  sectionTitle: { color: '#555', fontWeight: '700', letterSpacing: 0.5 },

  card: {
    marginHorizontal: 12,
    marginTop: 12,
    backgroundColor: '#FFFFFF', // branco
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2
  },

  sectionCard: {
  alignSelf: 'center',
  paddingHorizontal: 16,
  paddingTop: 6,      // mesmo valor
  paddingBottom: 6,   // mesmo valor pra equilibrar
  backgroundColor: '#fff',
  borderRadius: 12,
  marginVertical: 12,
  marginTop: 0,
  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 4,
},

  champRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  champLogo: { width: 24, height: 24, marginRight: 8 },
  champText: { color: '#9E9E9E', fontSize: 14, fontWeight: '600' }, // cinza

  matchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },

  teamBlock: {
    alignItems: 'center',
    width: 150,
  },
  logoBox: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogo: { width: 50, height: 50 },
  teamName: {
    color: '#000000', // preto
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 150,
    marginTop: 6,
    minHeight: 32
  },

  liveRow: { 
  flexDirection: 'row', 
  alignItems: 'center', 
  justifyContent: 'center', 
  marginTop: -25 // aproxima um pouco da hora
},
liveDot: { 
  color: 'red', 
  fontSize: 30, 
  fontWeight: 'bold', 
  marginRight: 4, 
  marginLeft: -2 // centraliza com a hora
},
liveText: { 
  color: 'red', 
  fontSize: 12, 
  fontWeight: 'bold' 
},


  timeWrap: {
  height: 50,
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',   // <— importante
},

  timeText: {
    color: '#000000', // preto
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 16,
    transform: [{ translateY: -16 }],
  },

  buttonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop:12 },
  playBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#EAEAEA' // botão mais claro
  },
  playBtnText: { color: '#000000', fontWeight: '600' }, // texto preto
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

reload: { marginTop: 12, backgroundColor: '#2a2f3a', padding: 10, borderRadius: 8 },
reloadText: { color: '#fff' }
});