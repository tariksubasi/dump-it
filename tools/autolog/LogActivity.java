// Reference copy. Create the Java action "LogActivity" in Studio Pro with the parameters below,
// deploy once so Studio Pro generates javasource/logging/actions/LogActivity.java,
// then paste the USER CODE and EXTRA CODE blocks into that generated file.
// Needs logging/Journal.java (copy it from this folder to javasource/logging/).
//
// Studio Pro parameters (names must match, autolog.py fills them):
//   Type parameters : ObjType, ListType
//   ActivityName    String
//   VariableName    String
//   VariableValue   String
//   VariableObject  Object  (type parameter ObjType)
//   VariableList    List    (type parameter ListType)
//   FlowName        String
//   LogNodeName     String
//   Level           Enumeration CommunityCommons.LogLevel
//   Return type     Nothing

package logging.actions;

import com.mendix.core.Core;
import com.mendix.logging.ILogNode;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.webui.CustomJavaAction;
import communitycommons.proxies.LogLevel;

public class LogActivity extends CustomJavaAction<java.lang.Void>
{
	private java.lang.String ActivityName;
	private java.lang.String VariableName;
	private java.lang.String VariableValue;
	private IMendixObject VariableObject;
	private java.util.List<IMendixObject> VariableList;
	private java.lang.String FlowName;
	private java.lang.String LogNodeName;
	private communitycommons.proxies.LogLevel Level;

	public LogActivity(IContext context, java.lang.String ActivityName, java.lang.String VariableName, java.lang.String VariableValue, IMendixObject VariableObject, java.util.List<IMendixObject> VariableList, java.lang.String FlowName, java.lang.String LogNodeName, java.lang.String Level)
	{
		super(context);
		this.ActivityName = ActivityName;
		this.VariableName = VariableName;
		this.VariableValue = VariableValue;
		this.VariableObject = VariableObject;
		this.VariableList = VariableList;
		this.FlowName = FlowName;
		this.LogNodeName = LogNodeName;
		this.Level = Level == null ? null : communitycommons.proxies.LogLevel.valueOf(Level);
	}

	@java.lang.Override
	public java.lang.Void executeAction() throws Exception
	{
		// BEGIN USER CODE
		try {
			String node = isBlank(LogNodeName) ? "Logging" : LogNodeName;
			ILogNode log = Core.getLogger(node);
			LogLevel level = Level == null ? LogLevel.Info : Level;
			if (isEnabled(log, level)) {
				String step = "[" + (isBlank(ActivityName) ? "<unnamed>" : ActivityName) + "] "
					+ (isBlank(VariableName) ? "<void>" : VariableName + " = " + describeValue(getContext(), VariableObject, VariableList, VariableValue));
				// Inside StartJournal ... FlushJournal the step joins the journal block; otherwise it is written now.
				if (logging.Journal.record(getContext(), log, level, ActivityName, step)) {
					return null;
				}
				String chain = callChain(getContext());
				String flow = isBlank(FlowName) ? logging.LogSink.currentMicroflow(getContext()) : FlowName;
				String message = "Activity | cid=" + logging.TraceContext.get()
					+ " | at=" + java.time.OffsetDateTime.now()
					+ " | flow=" + flow
					+ (chain.isEmpty() ? "" : " | chain=" + chain)
					+ " | " + step;
				logging.LogSink.dispatch(log, level, node, message);
			}
		} catch (Throwable t) {
			// Logging must never break the calling flow: swallow, only write to console.
			try {
				Core.getLogger("Logging").error("LogActivity failed (ignored): " + t.getMessage());
			} catch (Throwable ignored) {
			}
		}
		return null;
		// END USER CODE
	}

	/**
	 * Returns a string representation of this action
	 * @return a string representation of this action
	 */
	@java.lang.Override
	public java.lang.String toString()
	{
		return "LogActivity";
	}

	// BEGIN EXTRA CODE
	private static final int MAX_VALUE_LENGTH = 2000;

	private static boolean isBlank(String s) {
		return s == null || s.trim().isEmpty();
	}

	// Guard heavy string building: only Trace/Debug are typically disabled in production.
	private static boolean isEnabled(ILogNode log, LogLevel level) {
		if (level == LogLevel.Trace) {
			return log.isTraceEnabled();
		}
		if (level == LogLevel.Debug) {
			return log.isDebugEnabled();
		}
		return true;
	}

	// Microflow call chain from the runtime action stack, outermost first, without this Java action itself.
	private static String callChain(IContext context) {
		try {
			// Same API as Ulug.JA_GetCurrentMicroflowName; var keeps the runtime's own stack type.
			var stack = context.getActionStack();
			StringBuilder sb = new StringBuilder();
			for (int i = 0; i < stack.size() - 1; i++) {
				if (sb.length() > 0) {
					sb.append(" > ");
				}
				sb.append(stack.get(i).getActionName());
			}
			return sb.toString();
		} catch (Exception e) {
			return "";
		}
	}

	// Object and list win over the string value: they arrive as real Mendix objects.
	private static String describeValue(IContext context, IMendixObject object, java.util.List<IMendixObject> list, String value) {
		if (object != null) {
			return logging.Journal.describeObject(context, object);
		}
		if (list != null) {
			return logging.Journal.describeList(context, list);
		}
		if (value == null) {
			return "<null>";
		}
		if (value.isEmpty()) {
			return "<empty>";
		}
		if (value.length() <= MAX_VALUE_LENGTH) {
			return value;
		}
		return value.substring(0, MAX_VALUE_LENGTH) + "...(+" + (value.length() - MAX_VALUE_LENGTH) + " chars)";
	}
	// END EXTRA CODE
}
