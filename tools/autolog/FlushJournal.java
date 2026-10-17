// Reference copy. Create the Java action "FlushJournal" in the Logging module in Studio Pro:
//   LogNodeName  String
//   Level        Enumeration CommunityCommons.LogLevel
//   Return type  Nothing
// Deploy once, then paste the USER CODE block into javasource/logging/actions/FlushJournal.java.
// Needs logging/Journal.java.
//
// Put ONE FlushJournal call before the end event of a microflow: autolog --insert then logs every
// activity of that microflow, and FlushJournal writes all steps as one block.

package logging.actions;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.webui.CustomJavaAction;
import communitycommons.proxies.LogLevel;

public class FlushJournal extends CustomJavaAction<java.lang.Void>
{
	private java.lang.String LogNodeName;
	private communitycommons.proxies.LogLevel Level;

	public FlushJournal(IContext context, java.lang.String LogNodeName, java.lang.String Level)
	{
		super(context);
		this.LogNodeName = LogNodeName;
		this.Level = Level == null ? null : communitycommons.proxies.LogLevel.valueOf(Level);
	}

	@java.lang.Override
	public java.lang.Void executeAction() throws Exception
	{
		// BEGIN USER CODE
		try {
			String node = (LogNodeName == null || LogNodeName.trim().isEmpty()) ? "Logging" : LogNodeName;
			logging.Journal.flush(getContext(), Core.getLogger(node), Level == null ? LogLevel.Info : Level, node);
		} catch (Throwable t) {
			// Logging must never break the calling flow: swallow, only write to console.
			try {
				Core.getLogger("Logging").error("FlushJournal failed (ignored): " + t.getMessage());
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
		return "FlushJournal";
	}

	// BEGIN EXTRA CODE
	// END EXTRA CODE
}
