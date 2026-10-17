// Reference copy. Create the Java action "StartJournal" in the Logging module in Studio Pro:
//   no parameters, return type Nothing.
// Deploy once, then paste the USER CODE block into javasource/logging/actions/StartJournal.java.
// Needs logging/Journal.java. autolog --insert puts this call right after the start event.

package logging.actions;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.webui.CustomJavaAction;

public class StartJournal extends CustomJavaAction<java.lang.Void>
{
	public StartJournal(IContext context)
	{
		super(context);
	}

	@java.lang.Override
	public java.lang.Void executeAction() throws Exception
	{
		// BEGIN USER CODE
		try {
			logging.Journal.open(getContext());
		} catch (Throwable t) {
			// Logging must never break the calling flow: swallow, only write to console.
			try {
				Core.getLogger("Logging").error("StartJournal failed (ignored): " + t.getMessage());
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
		return "StartJournal";
	}

	// BEGIN EXTRA CODE
	// END EXTRA CODE
}
