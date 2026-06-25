import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { useApi, useBackend, useDiscovery } from "../api";
import { setAppLanguage } from "../i18n";
import { useProfile } from "../profile";
import ChipSelect from "../components/ChipSelect";
import TimeGradientBackground from "../components/TimeGradientBackground";

// A generic placeholder icon for a configured device in Settings. The actual device icon
// (photo) is chosen on the device page, so Settings only needs to tell batteries from
// inverters at a glance — inferred from the driver name.
const genericDeviceIcon = (d) =>
  /jk|bms|batt|pylon|seplos|daly/i.test(d?.driver || "")
    ? "battery-half-outline"
    : "hardware-chip-outline";

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
// serial/tcp/tunnel all drive a real serial port whose baud matters; tcp & tunnel pass it
// through to the bridge (param key "baud"), serial sets it directly ("baudrate").
const usesBaud = (type) => type === "serial" || type === "tcp" || type === "tunnel";

function withBaud(attach, baud) {
  if (!baud || !usesBaud(attach.type)) return attach;
  const key = attach.type === "serial" ? "baudrate" : "baud";
  return { ...attach, params: { ...attach.params, [key]: Number(baud) } };
}

function portKey(attach) {
  const p = attach?.params || {};
  if (attach?.type === "tcp") return `tcp:${p.host}:${p.port}`;
  if (attach?.type === "tunnel") return `tunnel:${p.bridge}:${p.target}`;
  if (attach?.type === "serial") return `serial:${p.port}`;
  if (attach?.type === "hidraw") return `hidraw:${p.path}`;
  return JSON.stringify(attach || {});
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { name, setName } = useProfile();
  const api = useApi();
  const { baseUrl, setBaseUrl } = useBackend();
  const { ports, devices, bridges, connected } = useDiscovery();

  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [drivers, setDrivers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => setUrlDraft(baseUrl), [baseUrl]);
  useEffect(() => {
    api.getDrivers().then(setDrivers).catch(() => setDrivers(["axpert", "jk_bms", "mock"]));
  }, [baseUrl]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const attach = (cfg) => run(() => api.addDevice(cfg));
  const toggle = (d) => run(() => api.updateDevice(d.id, { enabled: !d.enabled }));
  const remove = (d) =>
    Alert.alert(t("settings.removeTitle"), t("settings.removeQuestion", { name: d.name }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.remove"), style: "destructive", onPress: () => run(() => api.removeDevice(d.id)) },
    ]);

  async function testConnection() {
    setBaseUrl(urlDraft);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${urlDraft.replace(/\/+$/, "")}/api/health`);
      Alert.alert(
        res.ok ? t("settings.connected") : t("settings.reachable"),
        t("settings.backendResponse", { status: res.status })
      );
    } catch (e) {
      Alert.alert(t("settings.connectionFailed"), e.message);
    } finally {
      setBusy(false);
    }
  }

  const attachedKeys = new Set(devices.map((d) => portKey(d.transport)));

  return (
    <TimeGradientBackground>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 150, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t("settings.title")}</Text>

        <Text style={styles.section}>{t("settings.profile")}</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t("settings.yourName")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder={t("settings.yourName")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.nameInput]}
          />
        </View>

        <Text style={styles.section}>{t("settings.language")}</Text>
        <View style={[styles.card, styles.languageCard]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.devName}>
              {i18n.resolvedLanguage === "ro" ? t("settings.romanian") : t("settings.english")}
            </Text>
            <Text style={styles.muted}>{t("settings.languageDescription")}</Text>
          </View>
          <Switch
            value={i18n.resolvedLanguage === "ro"}
            onValueChange={(enabled) => setAppLanguage(enabled ? "ro" : "en")}
            trackColor={{ false: colors.cardAlt, true: colors.yellowDeep }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.cardAlt}
          />
        </View>

        {/* backend connection */}
        <Text style={styles.section}>{t("settings.backend")}</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t("settings.serverUrl")}</Text>
          <TextInput
            value={urlDraft}
            onChangeText={setUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.0.13:8000"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <View style={styles.connRow}>
            <View style={[styles.dot, { backgroundColor: connected ? colors.green : colors.red }]} />
            <Text style={styles.connText}>
              {connected ? t("settings.liveConnected") : t("settings.notConnected")}
            </Text>
          </View>
          <Pressable style={styles.primaryBtn} onPress={testConnection} disabled={busy}>
            <Text style={styles.primaryBtnText}>{t("settings.saveTest")}</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {/* configured devices */}
        <Text style={styles.section}>{t("settings.configuredDevices")}</Text>
        {devices.length === 0 && (
          <Text style={styles.muted}>{t("settings.noDevices")}</Text>
        )}
        {devices.map((d) => (
          <View key={d.id} style={styles.card}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={styles.deviceIcon}>
                <Ionicons name={genericDeviceIcon(d)} size={22} color={colors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.devName}>{d.name}</Text>
                <Text style={styles.muted}>
                  {d.driver} ·{" "}
                  {d.transport?.params?.port ||
                    d.transport?.params?.path ||
                    (d.transport?.type === "tcp"
                      ? `${d.transport.params.host}:${d.transport.params.port}`
                      : d.transport?.type)}
                </Text>
                <View style={styles.connRow}>
                  <View style={[styles.dot, { backgroundColor: d.online ? colors.green : colors.red }]} />
                  <Text style={styles.connText}>
                    {d.online ? t("common.online") : t("common.offline")}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.btnRow}>
              <Pressable style={styles.smallBtn} onPress={() => toggle(d)} disabled={busy}>
                <Text style={styles.smallBtnText}>
                  {d.enabled ? t("settings.disable") : t("settings.enable")}
                </Text>
              </Pressable>
              <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={() => remove(d)} disabled={busy}>
                <Text style={[styles.smallBtnText, { color: "#fff" }]}>
                  {t("common.remove")}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* bridges */}
        <Text style={styles.section}>{t("settings.usbBridges")}</Text>
        {bridges.length === 0 ? (
          <Text style={styles.muted}>
            {t("settings.noBridgeBefore")}{" "}
            <Text style={styles.code}>python3 tools/usb_bridge.py</Text>{" "}
            {t("settings.noBridgeAfter")}
          </Text>
        ) : (
          bridges.map((b) => (
            <View key={b.url} style={styles.bridgeRow}>
              <View style={[styles.dot, { backgroundColor: colors.green }]} />
              <Text style={styles.code}>{b.url}</Text>
            </View>
          ))
        )}

        {/* detected ports */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>{t("settings.detectedPorts")}</Text>
          <Text style={styles.muted}>
            {connected ? t("settings.live") : t("settings.reconnecting")}
          </Text>
        </View>
        {ports.length === 0 && (
          <Text style={styles.muted}>{t("settings.noPorts")}</Text>
        )}
        {ports.map((p) => (
          <PortRow
            key={`${p.source}:${p.path}`}
            port={p}
            drivers={drivers}
            busy={busy}
            attached={attachedKeys.has(portKey(p.attach))}
            onAttach={attach}
          />
        ))}

        {/* manual add */}
        <Pressable style={styles.manualToggle} onPress={() => setShowManual((s) => !s)}>
          <Ionicons name={showManual ? "chevron-down" : "chevron-forward"} size={16} color={colors.ink} />
          <Text style={styles.manualToggleText}>{t("settings.addManually")}</Text>
        </Pressable>
        {showManual && <ManualForm drivers={drivers} busy={busy} onAttach={attach} />}

        {busy && <ActivityIndicator style={{ marginTop: 20 }} color={colors.ink} />}
      </ScrollView>
    </TimeGradientBackground>
  );
}

function PortRow({ port, drivers, busy, attached, onAttach }) {
  const { t } = useTranslation();
  const [driver, setDriver] = useState(drivers.includes("axpert") ? "axpert" : drivers[0] || "axpert");
  const [name, setName] = useState(port.description || port.path);
  const [baud, setBaud] = useState(port.baud || 2400);
  const showBaud = usesBaud(port.attach?.type);

  return (
    <View style={styles.card}>
      <Text style={styles.devName}>{port.path}</Text>
      <Text style={styles.muted}>
        {port.source === "bridge" ? t("settings.hostUsb") : t("settings.local")} · {port.transport}
        {port.likely_inverter ? ` · ${t("settings.likelyInverter")}` : ""}
      </Text>
      <TextInput value={name} onChangeText={setName} placeholder={t("common.name")} placeholderTextColor={colors.muted} style={styles.input} />
      <ChipSelect label={t("common.driver")} options={drivers} value={driver} onChange={setDriver} />
      {showBaud && <ChipSelect label={t("common.baud")} options={BAUDS} value={baud} onChange={setBaud} />}
      <Pressable
        style={[styles.primaryBtn, attached && styles.disabledBtn]}
        disabled={busy || attached}
        onPress={() => onAttach({ name, driver, transport: withBaud(port.attach, baud) })}
      >
        <Text style={styles.primaryBtnText}>
          {attached ? t("settings.attached") : t("settings.attach")}
        </Text>
      </Pressable>
    </View>
  );
}

function ManualForm({ drivers, busy, onAttach }) {
  const { t } = useTranslation();
  const [type, setType] = useState("serial");
  const [path, setPath] = useState("/dev/ttyUSB0");
  const [host, setHost] = useState("host.docker.internal");
  const [tcpPort, setTcpPort] = useState("5500");
  const [baud, setBaud] = useState(2400);
  const [driver, setDriver] = useState(drivers[0] || "axpert");
  const [name, setName] = useState(() => t("settings.myInverter"));

  function submit() {
    let params;
    if (type === "serial") params = { port: path };
    else if (type === "hidraw") params = { path };
    else if (type === "tcp") params = { host, port: Number(tcpPort) };
    else params = {};
    onAttach({ name, driver, transport: withBaud({ type, params }, baud) });
  }

  return (
    <View style={styles.card}>
      <TextInput value={name} onChangeText={setName} placeholder={t("common.name")} placeholderTextColor={colors.muted} style={styles.input} />
      <ChipSelect label={t("common.driver")} options={drivers} value={driver} onChange={setDriver} />
      <ChipSelect
        label={t("common.transport")}
        options={["serial", "hidraw", "tcp", "mock"]}
        value={type}
        onChange={setType}
      />
      {type === "tcp" ? (
        <>
          <TextInput value={host} onChangeText={setHost} placeholder="host" placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} />
          <TextInput value={String(tcpPort)} onChangeText={setTcpPort} placeholder="5500" placeholderTextColor={colors.muted} keyboardType="number-pad" style={styles.input} />
        </>
      ) : type !== "mock" ? (
        <TextInput value={path} onChangeText={setPath} placeholder="/dev/ttyUSB0" placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} />
      ) : null}
      {usesBaud(type) && <ChipSelect label={t("common.baud")} options={BAUDS} value={baud} onChange={setBaud} />}
      <Pressable style={styles.primaryBtn} disabled={busy} onPress={submit}>
        <Text style={styles.primaryBtnText}>{t("settings.addDevice")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.6, marginBottom: 8 },
  section: { fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 22, marginBottom: 10 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 22, marginBottom: 10 },
  languageCard: { flexDirection: "row", alignItems: "center", gap: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 12,
  },
  fieldLabel: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
  },
  nameInput: { marginBottom: 0 },
  connRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  connText: { color: colors.muted, fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.yellow,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  disabledBtn: { backgroundColor: colors.cardAlt },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  devName: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  code: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  smallBtn: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  smallBtnText: { color: colors.ink, fontWeight: "600", fontSize: 14 },
  dangerBtn: { backgroundColor: colors.red, borderColor: colors.red },
  bridgeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
  },
  manualToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 12 },
  manualToggleText: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  error: { color: colors.red, fontSize: 13, marginBottom: 8 },
});
