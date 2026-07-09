CreatorFlow fixed project

Open this folder directly in VS Code:
CreatorFlow_FIXED

Do not open the parent folder. VS Code must see the .vscode folder, src folder, and settings.json together.

Run steps:
1. Make sure this JavaFX SDK folder exists:
   C:/Users/isdis/Downloads/openjfx-26_windows-x64_bin-sdk/javafx-sdk-26/lib
2. Make sure this JDK folder exists:
   C:/Users/isdis/AppData/Local/Programs/Eclipse Adoptium/jdk-25.0.2.10-hotspot
3. In VS Code, press Ctrl+Shift+P.
4. Run: Java: Clean Java Language Server Workspace
5. Choose: Restart and delete
6. Open src/main/java/creativeflow/Main.java
7. Go to Run and Debug and choose Run CreatorFlow.

If your JavaFX SDK is in a different location, update both files:
.vscode/settings.json
.vscode/launch.json
