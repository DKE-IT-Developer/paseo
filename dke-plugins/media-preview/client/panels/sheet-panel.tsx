import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginFilePanelProps, useFileBytes } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { SHEET_AUTOLOAD_MAX_BYTES, SHEET_MAX_COLS, SHEET_MAX_ROWS } from "../../shared/limits";
import { shouldAutoLoad } from "../autoload";
import { ErrorText, SizeGate } from "../size-gate";
import { parseWorkbook } from "../sheet/parse";
import { SPACING } from "../ui-spacing";
import { OfficeFlow } from "./office-panel";

const CELL_WIDTH = 140;

export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

interface CellItem {
  id: string;
  text: string;
}
interface RowItem {
  id: string;
  cells: CellItem[];
  header: boolean;
}

const STICKY_HEADER = [0];
const keyOfRow = (item: RowItem) => item.id;

function toRowItems(rows: string[][]): RowItem[] {
  return rows.map((cells, r) => ({
    id: `r${r}`,
    header: r === 0,
    cells: cells.map((text, c) => ({ id: `c${c}`, text })),
  }));
}

function Row({ item, theme }: { item: RowItem; theme: PluginTheme }) {
  const rowStyle = useMemo(
    () => ({
      flexDirection: "row" as const,
      backgroundColor: theme.colors.surface0,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.foreground,
    }),
    [theme],
  );
  const cellStyle = useMemo(
    () => ({
      width: CELL_WIDTH,
      padding: SPACING.xs,
      color: theme.colors.foreground,
      fontWeight: item.header ? ("700" as const) : ("400" as const),
    }),
    [theme, item.header],
  );
  return (
    <View style={rowStyle}>
      {item.cells.map((c) => (
        <Text key={c.id} style={cellStyle} numberOfLines={2}>
          {c.text}
        </Text>
      ))}
    </View>
  );
}

function SheetTab({
  id,
  name,
  selected,
  onSelect,
  styles,
}: {
  id: number;
  name: string;
  selected: boolean;
  onSelect: (id: number) => void;
  styles: { tab: object; tabOn: object; tabText: object; tabOnText: object };
}) {
  const onPress = useCallback(() => onSelect(id), [onSelect, id]);
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useMemo(
    () => (selected ? [styles.tab, styles.tabOn] : styles.tab),
    [selected, styles],
  );
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={state}
      accessibilityLabel={name}
      onPress={onPress}
      style={style}
    >
      <Text style={selected ? styles.tabOnText : styles.tabText}>{name}</Text>
    </Pressable>
  );
}

function SheetBody({
  bytes,
  theme,
  onPdf,
}: {
  bytes: Uint8Array;
  theme: PluginTheme;
  onPdf: () => void;
}) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...parseWorkbook(bytes, SHEET_MAX_ROWS) };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [bytes]);
  const [active, setActive] = useState(0);

  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: theme.colors.surface0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        padding: SPACING.sm,
        gap: SPACING.sm,
      },
      tab: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.xs,
        borderRadius: SPACING.radius,
      },
      tabOn: { backgroundColor: theme.colors.accent },
      tabOnText: { color: theme.colors.accentForeground },
      tabText: { color: theme.colors.foreground },
      notice: { color: theme.colors.foreground, padding: SPACING.sm },
      pdf: { marginLeft: "auto" as const, padding: SPACING.xs },
    }),
    [theme],
  );

  const sheet = parsed.ok ? parsed.sheets[Math.min(active, parsed.sheets.length - 1)] : undefined;
  const items = useMemo(() => (sheet ? toRowItems(sheet.rows) : []), [sheet]);
  const tabs = useMemo(
    () =>
      parsed.ok
        ? parsed.sheets.map((s, i) => ({ key: `t${i}:${s.name}`, id: i, name: s.name }))
        : [],
    [parsed],
  );
  const renderRow = useCallback(
    ({ item }: { item: RowItem }) => <Row item={item} theme={theme} />,
    [theme],
  );

  if (!parsed.ok) {
    return (
      <View style={styles.root}>
        <ErrorText message={parsed.message} theme={theme} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lihat sebagai PDF"
          onPress={onPdf}
        >
          <Text style={styles.tabText}>Lihat sebagai PDF</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.bar} accessibilityRole="tablist">
        {tabs.map((t) => (
          <SheetTab
            key={t.key}
            id={t.id}
            name={t.name}
            selected={t.id === active}
            onSelect={setActive}
            styles={styles}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lihat sebagai PDF"
          onPress={onPdf}
          style={styles.pdf}
        >
          <Text style={styles.tabText}>Lihat sebagai PDF</Text>
        </Pressable>
      </View>
      {sheet?.truncated ? (
        <Text
          style={styles.notice}
        >{`Menampilkan ${formatCount(SHEET_MAX_ROWS)} baris pertama`}</Text>
      ) : null}
      {sheet?.colsTruncated ? (
        <Text
          style={styles.notice}
        >{`Menampilkan ${formatCount(SHEET_MAX_COLS)} kolom pertama`}</Text>
      ) : null}
      {sheet ? (
        <ScrollView horizontal>
          <FlatList
            data={items}
            renderItem={renderRow}
            keyExtractor={keyOfRow}
            stickyHeaderIndices={STICKY_HEADER}
            initialNumToRender={40}
            windowSize={9}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

function SheetLoader({
  file,
  theme,
  onPdf,
}: Pick<PluginFilePanelProps, "file" | "theme"> & { onPdf: () => void }) {
  const result = useFileBytes(file);
  if (result.status === "loading") return <Loading />;
  if (result.status === "error") return <ErrorText message={result.error.message} theme={theme} />;
  return <SheetBody bytes={result.bytes} theme={theme} onPdf={onPdf} />;
}

export function SheetPanel(props: PluginFilePanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [asPdf, setAsPdf] = useState(false);
  const onLoad = useCallback(() => setConfirmed(true), []);
  const onPdf = useCallback(() => setAsPdf(true), []);
  const size = props.file.size;
  if (asPdf) return <OfficeFlow file={props.file} theme={props.theme} />;
  if (!confirmed && !shouldAutoLoad(size, SHEET_AUTOLOAD_MAX_BYTES)) {
    return (
      <SizeGate
        size={size}
        max={SHEET_AUTOLOAD_MAX_BYTES}
        onLoad={onLoad}
        onPdf={onPdf}
        theme={props.theme}
      />
    );
  }
  return <SheetLoader file={props.file} theme={props.theme} onPdf={onPdf} />;
}
