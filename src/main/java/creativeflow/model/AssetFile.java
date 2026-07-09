package creativeflow.model;

/** Basic asset-file data model. */
public class AssetFile {
    private String fileName;
    private String fileType;
    private String projectName;

    public AssetFile(String fileName, String fileType, String projectName) {
        this.fileName = fileName;
        this.fileType = fileType;
        this.projectName = projectName;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public String getFileType() {
        return fileType;
    }

    public void setFileType(String fileType) {
        this.fileType = fileType;
    }

    public String getProjectName() {
        return projectName;
    }

    public void setProjectName(String projectName) {
        this.projectName = projectName;
    }
}
