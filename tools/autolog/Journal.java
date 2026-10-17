// Plain helper class, not a Java action. Copy this file to javasource/logging/Journal.java
// (next to LogSink.java and TraceContext.java). Studio Pro keeps such files as they are.
//
// The journal collects the LogActivity steps of one microflow run (and of the sub-microflows it calls)
// and writes them as one block when FlushJournal runs:
//   StartJournal  -> open (only the outermost microflow opens; a sub-microflow joins the open journal)
//   LogActivity   -> record a step (when no journal is open, LogActivity writes its line at once, as before)
//   FlushJournal  -> write the block (only the outermost microflow writes; a sub-microflow adds an "end" line)
// A journal that is never flushed (the flow stopped with an uncaught error) is written, marked as not closed,
// when the next journal starts on the same thread.

package logging;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.mendix.core.Core;
import com.mendix.core.objectmanagement.member.MendixObjectReference;
import com.mendix.core.objectmanagement.member.MendixObjectReferenceSet;
import com.mendix.logging.ILogNode;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixIdentifier;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.systemwideinterfaces.core.IMendixObjectMember;
import communitycommons.proxies.LogLevel;

public final class Journal
{
	private static final ThreadLocal<Journal> CURRENT = new ThreadLocal<>();
	private static final int MAX_STEPS = 1000;
	private static final int MAX_PER_ACTIVITY = 20;    // a loop logs its first 20 turns, then only counts
	private static final int MAX_ATTR_LENGTH = 200;
	private static final int MAX_OBJECT_LENGTH = 2000;
	private static final int MAX_LIST_ITEMS = 5;
	private static final String[] SECRET_WORDS = { "password", "passwd", "secret", "token", "apikey", "api_key" };

	private final IContext context;
	private final String cid;
	private final int depth;
	private final String flow;
	private final long startedNanos = System.nanoTime();
	private final List<String> lines = new ArrayList<>();
	private final Map<String, Integer> perActivity = new LinkedHashMap<>();
	private final Map<String, Integer> skipped = new LinkedHashMap<>();
	private int steps;

	private Journal(IContext context, String cid, int depth, String flow) {
		this.context = context;
		this.cid = cid;
		this.depth = depth;
		this.flow = flow;
	}

	// ------------------------------------------------------------------ actions

	public static void open(IContext context) {
		String cid = TraceContext.get();
		int depth = depth(context);
		String flow = LogSink.currentMicroflow(context);
		Journal j = CURRENT.get();
		if (j != null) {
			if (j.sameRun(context, cid) && depth > j.depth) {
				j.add(depth, "> " + flow);
				return;
			}
			CURRENT.remove();
			j.writeUnclosed();
		}
		CURRENT.set(new Journal(context, cid, depth, flow));
	}

	/** Adds a step to the open journal. Returns false when no journal is open: the caller then logs at once. */
	public static boolean record(IContext context, ILogNode log, LogLevel level, String activity, String text) {
		Journal j = CURRENT.get();
		if (j == null || !j.sameRun(context, TraceContext.get())) {
			return false;
		}
		if (!isEnabled(log, level)) {
			return true;
		}
		String key = activity == null ? "" : activity;
		int seen = j.perActivity.merge(key, 1, Integer::sum);
		if (seen > MAX_PER_ACTIVITY || j.steps >= MAX_STEPS) {
			j.skipped.merge(key, 1, Integer::sum);
			return true;
		}
		j.steps++;
		j.add(depth(context), j.steps + ". " + time() + "  " + text);
		return true;
	}

	public static void flush(IContext context, ILogNode log, LogLevel level, String node) {
		Journal j = CURRENT.get();
		if (j == null) {
			return;
		}
		int depth = depth(context);
		if (j.sameRun(context, TraceContext.get()) && depth > j.depth) {
			j.add(depth, "< end " + LogSink.currentMicroflow(context));
			return;
		}
		CURRENT.remove();
		if (isEnabled(log, level)) {
			LogSink.dispatch(log, level, node, j.render(""));
		}
	}

	// ------------------------------------------------------------------ describing values

	/** Type, id, attributes (secrets masked); changed attributes are shown as old -> new. */
	public static String describeObject(IContext context, IMendixObject object) {
		if (object == null) {
			return "<null object>";
		}
		StringBuilder sb = new StringBuilder(object.getType()).append("[id=")
			.append(object.getId() == null ? "new" : object.getId().toLong()).append("] {");
		try {
			java.util.Set<String> allowed = LogSink.allowedAttributes();
			boolean first = true;
			for (Map.Entry<String, ? extends IMendixObjectMember<?>> e : object.getMembers(context).entrySet()) {
				IMendixObjectMember<?> m = e.getValue();
				if (m.isVirtual() || (!allowed.isEmpty() && !allowed.contains(e.getKey()))) {
					continue;
				}
				if (sb.length() >= MAX_OBJECT_LENGTH) {
					sb.append(", ...");
					break;
				}
				sb.append(first ? "" : ", ").append(e.getKey()).append('=').append(describeMember(context, e.getKey(), m));
				first = false;
			}
		} catch (Exception ex) {
			sb.append("<error:").append(ex.getClass().getSimpleName()).append('>');
		}
		return sb.append('}').toString();
	}

	public static String describeList(IContext context, List<IMendixObject> list) {
		StringBuilder sb = new StringBuilder("list[").append(list.size()).append("]");
		for (int i = 0; i < Math.min(list.size(), MAX_LIST_ITEMS); i++) {
			IMendixObject o = list.get(i);
			sb.append(i == 0 ? " " : ", ").append(o == null ? "<null>" : o.getType() + "[id=" + (o.getId() == null ? "new" : o.getId().toLong()) + "]");
		}
		return list.size() > MAX_LIST_ITEMS ? sb.append(", ...").toString() : sb.toString();
	}

	private static String describeMember(IContext context, String name, IMendixObjectMember<?> m) {
		try {
			if (m instanceof MendixObjectReference) {
				IMendixIdentifier id = ((MendixObjectReference) m).getValue(context);
				return id == null ? "<empty ref>" : "ref(" + id.toLong() + ")";
			}
			if (m instanceof MendixObjectReferenceSet) {
				List<IMendixIdentifier> ids = ((MendixObjectReferenceSet) m).getValue(context);
				return ids == null || ids.isEmpty() ? "<empty list>" : "list[" + ids.size() + "]";
			}
			if (isSecret(name)) {
				return "***";
			}
			String now = text(m.getValue(context));
			if (m.isValueChanged(context)) {
				return text(m.getOriginalValue(context)) + " -> " + now;
			}
			return now;
		} catch (Exception e) {
			return "<error:" + e.getClass().getSimpleName() + ">";
		}
	}

	private static String text(Object value) {
		if (value == null) {
			return "<null>";
		}
		String s = String.valueOf(value);
		if (s.isEmpty()) {
			return "<empty>";
		}
		return s.length() <= MAX_ATTR_LENGTH ? s : s.substring(0, MAX_ATTR_LENGTH) + "...(+" + (s.length() - MAX_ATTR_LENGTH) + ")";
	}

	private static boolean isSecret(String name) {
		String n = name.toLowerCase();
		for (String w : SECRET_WORDS) {
			if (n.contains(w)) {
				return true;
			}
		}
		return false;
	}

	// ------------------------------------------------------------------ helpers

	private boolean sameRun(IContext context, String cid) {
		return this.context == context || (this.cid != null && this.cid.equals(cid));
	}

	private void add(int depth, String line) {
		int indent = Math.max(0, depth - this.depth);
		lines.add("  ".repeat(indent + 1) + line);
	}

	private String render(String note) {
		long ms = (System.nanoTime() - startedNanos) / 1_000_000;
		StringBuilder sb = new StringBuilder("Journal | cid=").append(cid).append(" | flow=").append(flow)
			.append(" | steps=").append(steps).append(" | ").append(ms).append(" ms").append(note);
		for (String line : lines) {
			sb.append('\n').append(line);
		}
		for (Map.Entry<String, Integer> e : skipped.entrySet()) {
			sb.append("\n  ... ").append(e.getKey()).append(": ").append(e.getValue()).append(" more step(s) not shown");
		}
		return sb.toString();
	}

	private void writeUnclosed() {
		try {
			ILogNode log = Core.getLogger("Logging");
			LogSink.dispatch(log, LogLevel.Warning, "Logging",
				render(" | NOT CLOSED: the flow stopped before FlushJournal (uncaught error?)"));
		} catch (Throwable ignored) {
			// Logging must never break the calling flow.
		}
	}

	private static int depth(IContext context) {
		try {
			return context.getActionStack().size();
		} catch (Exception e) {
			return 0;
		}
	}

	private static String time() {
		return java.time.LocalTime.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString();
	}

	public static boolean isEnabled(ILogNode log, LogLevel level) {
		if (level == LogLevel.Trace) {
			return log.isTraceEnabled();
		}
		if (level == LogLevel.Debug) {
			return log.isDebugEnabled();
		}
		return true;
	}
}
