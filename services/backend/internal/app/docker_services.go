package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrDockerUnavailable         = errors.New("docker daemon is unavailable")
	ErrDockerProtectedContainer  = errors.New("the Wharnex backend container cannot control itself")
	ErrDockerProtectedProject    = errors.New("the Wharnex compose project contains the backend container")
	ErrDockerRedeployUnavailable = errors.New("docker compose redeploy is unavailable")
	ErrDockerResourceInUse       = errors.New("docker resource is in use")
)

const (
	dockerServicesTimeout = 12 * time.Second
	dockerMutationTimeout = 45 * time.Second
	dockerRedeployTimeout = 2 * time.Minute
)

var dockerIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

type DockerContainer struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Image          string `json:"image"`
	State          string `json:"state"`
	Condition      string `json:"condition"`
	Status         string `json:"status"`
	Ports          string `json:"ports,omitempty"`
	Networks       string `json:"networks,omitempty"`
	ComposeProject string `json:"compose_project,omitempty"`
	ComposeService string `json:"compose_service,omitempty"`
	ExitCode       int    `json:"exit_code,omitempty"`
	Error          string `json:"error,omitempty"`
	Protected      bool   `json:"protected,omitempty"`
}

type DockerComposeService struct {
	Name           string `json:"name"`
	ContainerCount int    `json:"container_count"`
	RunningCount   int    `json:"running_count"`
	ErrorCount     int    `json:"error_count"`
}

type DockerComposeProject struct {
	Name              string                 `json:"name"`
	ContainerCount    int                    `json:"container_count"`
	RunningCount      int                    `json:"running_count"`
	ErrorCount        int                    `json:"error_count"`
	StoppedCount      int                    `json:"stopped_count"`
	Protected         bool                   `json:"protected,omitempty"`
	RedeployAvailable bool                   `json:"redeploy_available"`
	RedeployReason    string                 `json:"redeploy_reason,omitempty"`
	ConfigFiles       []string               `json:"config_files,omitempty"`
	Services          []DockerComposeService `json:"services,omitempty"`
	runtime           dockerComposeRuntime
}

type DockerImage struct {
	ID             string `json:"id"`
	Repository     string `json:"repository"`
	Tag            string `json:"tag"`
	Size           string `json:"size"`
	CreatedSince   string `json:"created_since,omitempty"`
	InUse          bool   `json:"in_use"`
	ContainerCount int    `json:"container_count"`
}

type DockerVolume struct {
	Name           string `json:"name"`
	Driver         string `json:"driver"`
	Mountpoint     string `json:"mountpoint,omitempty"`
	Scope          string `json:"scope,omitempty"`
	InUse          bool   `json:"in_use"`
	ContainerCount int    `json:"container_count"`
}

type DockerNetwork struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Driver         string `json:"driver"`
	Scope          string `json:"scope,omitempty"`
	Internal       bool   `json:"internal,omitempty"`
	InUse          bool   `json:"in_use"`
	ContainerCount int    `json:"container_count"`
}

type DockerOverview struct {
	ComposeProjects []DockerComposeProject `json:"compose_projects"`
	Containers      []DockerContainer      `json:"containers"`
	Images          []DockerImage          `json:"images"`
	Volumes         []DockerVolume         `json:"volumes"`
	Networks        []DockerNetwork        `json:"networks"`
	RefreshedAt     time.Time              `json:"refreshed_at"`
}

type DockerLogs struct {
	ContainerID string `json:"container_id"`
	Tail        int    `json:"tail"`
	Content     string `json:"content"`
}

type dockerComposeRuntime struct {
	WorkingDir       string
	ConfigFiles      []string
	EnvironmentFiles []string
}

type dockerContainerRow struct {
	ID       string `json:"ID"`
	Names    string `json:"Names"`
	Image    string `json:"Image"`
	State    string `json:"State"`
	Status   string `json:"Status"`
	Ports    string `json:"Ports"`
	Networks string `json:"Networks"`
}

type dockerImageRow struct {
	ID           string `json:"ID"`
	Repository   string `json:"Repository"`
	Tag          string `json:"Tag"`
	Size         string `json:"Size"`
	CreatedSince string `json:"CreatedSince"`
}

type dockerVolumeRow struct {
	Name       string `json:"Name"`
	Driver     string `json:"Driver"`
	Mountpoint string `json:"Mountpoint"`
	Scope      string `json:"Scope"`
}

type dockerNetworkRow struct {
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	Driver   string `json:"Driver"`
	Scope    string `json:"Scope"`
	Internal any    `json:"Internal"`
}

type dockerContainerInspect struct {
	ID     string `json:"Id"`
	Image  string `json:"Image"`
	Config struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Status     string `json:"Status"`
		Running    bool   `json:"Running"`
		Paused     bool   `json:"Paused"`
		Restarting bool   `json:"Restarting"`
		OOMKilled  bool   `json:"OOMKilled"`
		Dead       bool   `json:"Dead"`
		ExitCode   int    `json:"ExitCode"`
		Error      string `json:"Error"`
	} `json:"State"`
	Mounts []struct {
		Name string `json:"Name"`
	} `json:"Mounts"`
	NetworkSettings struct {
		Networks map[string]json.RawMessage `json:"Networks"`
	} `json:"NetworkSettings"`
}

func (s *Service) DockerOverview(ctx context.Context, sessionID string) (DockerOverview, error) {
	if err := s.requireDockerSession(sessionID); err != nil {
		return DockerOverview{}, err
	}
	probeCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()

	containerRows, err := dockerJSONLines[dockerContainerRow](probeCtx, "container", "ls", "-a", "--no-trunc", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	imageRows, err := dockerJSONLines[dockerImageRow](probeCtx, "image", "ls", "--no-trunc", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	volumeRows, err := dockerJSONLines[dockerVolumeRow](probeCtx, "volume", "ls", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	networkRows, err := dockerJSONLines[dockerNetworkRow](probeCtx, "network", "ls", "--no-trunc", "--format", "{{json .}}")
	if err != nil {
		return DockerOverview{}, err
	}
	inspections := make([]dockerContainerInspect, 0, len(containerRows))
	if len(containerRows) > 0 {
		args := []string{"container", "inspect"}
		for _, row := range containerRows {
			args = append(args, row.ID)
		}
		inspections, err = dockerJSON[dockerContainerInspect](probeCtx, args...)
		if err != nil {
			if errors.Is(err, ErrDockerUnavailable) {
				return DockerOverview{}, err
			}
			// Containers can disappear between list and inspect. Keep the panel
			// available from the list snapshot and recover richer metadata on
			// the next refresh instead of treating that race as daemon failure.
			inspections = inspections[:0]
		}
	}

	overview := buildDockerOverview(containerRows, inspections, imageRows, volumeRows, networkRows, time.Now().UTC())
	for index := range overview.ComposeProjects {
		project := &overview.ComposeProjects[index]
		configuredServices, configErr := dockerComposeConfiguredServices(probeCtx, project.Name, project.runtime)
		if configErr == nil {
			project.Services = mergeDockerComposeServices(project.Services, configuredServices)
		}
	}
	return overview, nil
}

func buildDockerOverview(containerRows []dockerContainerRow, inspections []dockerContainerInspect, imageRows []dockerImageRow, volumeRows []dockerVolumeRow, networkRows []dockerNetworkRow, refreshedAt time.Time) DockerOverview {
	inspectByID := make(map[string]dockerContainerInspect, len(inspections))
	imageUsage := make(map[string]int)
	volumeUsage := make(map[string]int)
	networkUsage := make(map[string]int)
	for _, inspected := range inspections {
		inspectByID[inspected.ID] = inspected
		if inspected.Image != "" {
			imageUsage[inspected.Image]++
		}
		for _, mount := range inspected.Mounts {
			if mount.Name != "" {
				volumeUsage[mount.Name]++
			}
		}
		for networkName := range inspected.NetworkSettings.Networks {
			networkUsage[networkName]++
		}
	}

	overview := DockerOverview{
		ComposeProjects: make([]DockerComposeProject, 0),
		Containers:      make([]DockerContainer, 0, len(containerRows)),
		Images:          make([]DockerImage, 0, len(imageRows)),
		Volumes:         make([]DockerVolume, 0, len(volumeRows)),
		Networks:        make([]DockerNetwork, 0, len(networkRows)),
		RefreshedAt:     refreshedAt,
	}
	projectStats := make(map[string]*DockerComposeProject)
	projectServices := make(map[string]map[string]*DockerComposeService)
	for _, row := range containerRows {
		inspected := inspectByID[row.ID]
		labels := inspected.Config.Labels
		condition := dockerContainerCondition(inspected, row.State)
		container := DockerContainer{
			ID: row.ID, Name: row.Names, Image: row.Image, State: row.State, Condition: condition, Status: row.Status,
			Ports: row.Ports, Networks: row.Networks, ExitCode: inspected.State.ExitCode, Error: strings.TrimSpace(inspected.State.Error), Protected: protectedDockerTarget(row.ID),
		}
		if labels != nil {
			container.ComposeProject = strings.TrimSpace(labels["com.docker.compose.project"])
			container.ComposeService = strings.TrimSpace(labels["com.docker.compose.service"])
		}
		overview.Containers = append(overview.Containers, container)
		if container.ComposeProject != "" {
			project := projectStats[container.ComposeProject]
			runtime := dockerComposeRuntimeFromLabels(labels)
			if project == nil {
				project = &DockerComposeProject{Name: container.ComposeProject, runtime: runtime}
				projectStats[container.ComposeProject] = project
			} else if len(project.runtime.ConfigFiles) == 0 && len(runtime.ConfigFiles) > 0 {
				project.runtime = runtime
			}
			project.ContainerCount++
			project.Protected = project.Protected || container.Protected
			switch condition {
			case "running", "restarting":
				project.RunningCount++
			case "error":
				project.ErrorCount++
			default:
				project.StoppedCount++
			}
			if container.ComposeService != "" {
				services := projectServices[container.ComposeProject]
				if services == nil {
					services = make(map[string]*DockerComposeService)
					projectServices[container.ComposeProject] = services
				}
				service := services[container.ComposeService]
				if service == nil {
					service = &DockerComposeService{Name: container.ComposeService}
					services[container.ComposeService] = service
				}
				service.ContainerCount++
				switch condition {
				case "running", "restarting":
					service.RunningCount++
				case "error":
					service.ErrorCount++
				}
			}
		}
	}
	projectNames := make([]string, 0, len(projectStats))
	for name := range projectStats {
		projectNames = append(projectNames, name)
	}
	sort.Strings(projectNames)
	for _, name := range projectNames {
		project := projectStats[name]
		project.ConfigFiles = append([]string(nil), project.runtime.ConfigFiles...)
		serviceNames := make([]string, 0, len(projectServices[name]))
		for serviceName := range projectServices[name] {
			serviceNames = append(serviceNames, serviceName)
		}
		sort.Strings(serviceNames)
		for _, serviceName := range serviceNames {
			project.Services = append(project.Services, *projectServices[name][serviceName])
		}
		project.RedeployAvailable, project.RedeployReason = dockerComposeRedeployAvailability(project.runtime)
		if project.Protected {
			project.RedeployAvailable = false
			project.RedeployReason = "Este Compose contém o backend Wharnex e não pode ser recriado por esta interface."
		}
		overview.ComposeProjects = append(overview.ComposeProjects, *project)
	}
	for _, row := range imageRows {
		count := imageUsage[row.ID]
		overview.Images = append(overview.Images, DockerImage{ID: row.ID, Repository: row.Repository, Tag: row.Tag, Size: row.Size, CreatedSince: row.CreatedSince, InUse: count > 0, ContainerCount: count})
	}
	for _, row := range volumeRows {
		count := volumeUsage[row.Name]
		overview.Volumes = append(overview.Volumes, DockerVolume{Name: row.Name, Driver: row.Driver, Mountpoint: row.Mountpoint, Scope: row.Scope, InUse: count > 0, ContainerCount: count})
	}
	for _, row := range networkRows {
		count := networkUsage[row.Name]
		overview.Networks = append(overview.Networks, DockerNetwork{ID: row.ID, Name: row.Name, Driver: row.Driver, Scope: row.Scope, Internal: parseDockerBool(row.Internal), InUse: count > 0, ContainerCount: count})
	}
	return overview
}

func dockerComposeRuntimeFromLabels(labels map[string]string) dockerComposeRuntime {
	if labels == nil {
		return dockerComposeRuntime{}
	}
	workingDir := strings.TrimSpace(labels["com.docker.compose.project.working_dir"])
	return dockerComposeRuntime{
		WorkingDir:       filepath.Clean(workingDir),
		ConfigFiles:      dockerComposeLabelPaths(labels["com.docker.compose.project.config_files"], workingDir),
		EnvironmentFiles: dockerComposeLabelPaths(labels["com.docker.compose.project.environment_file"], workingDir),
	}
}

func dockerComposeLabelPaths(raw, workingDir string) []string {
	parts := strings.Split(raw, ",")
	paths := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		if !filepath.IsAbs(value) && strings.TrimSpace(workingDir) != "" {
			value = filepath.Join(workingDir, value)
		}
		paths = append(paths, filepath.Clean(value))
	}
	return paths
}

func dockerComposeRedeployAvailability(runtime dockerComposeRuntime) (bool, string) {
	workingDir := strings.TrimSpace(runtime.WorkingDir)
	if workingDir == "" || workingDir == "." {
		return false, "O Docker não informou a pasta de trabalho deste projeto Compose."
	}
	info, err := os.Stat(workingDir)
	if err != nil || !info.IsDir() {
		return false, "A pasta de trabalho do Compose não está acessível ao Wharnex."
	}
	if len(runtime.ConfigFiles) == 0 {
		return false, "O Docker não informou os ficheiros Compose usados neste projeto."
	}
	for _, configFile := range runtime.ConfigFiles {
		info, err := os.Stat(configFile)
		if err != nil || info.IsDir() {
			return false, "Um ficheiro Compose necessário ao redeploy não está acessível ao Wharnex."
		}
	}
	for _, envFile := range runtime.EnvironmentFiles {
		info, err := os.Stat(envFile)
		if err != nil || info.IsDir() {
			return false, "O ficheiro de ambiente usado pelo Compose não está acessível ao Wharnex."
		}
	}
	return true, ""
}

func dockerComposeBaseArgs(project string, runtime dockerComposeRuntime) []string {
	args := []string{"compose", "-p", project, "--project-directory", runtime.WorkingDir}
	for _, configFile := range runtime.ConfigFiles {
		args = append(args, "-f", configFile)
	}
	for _, envFile := range runtime.EnvironmentFiles {
		args = append(args, "--env-file", envFile)
	}
	return args
}

func dockerComposeRedeployArgs(project string, runtime dockerComposeRuntime) []string {
	return append(dockerComposeBaseArgs(project, runtime), "up", "-d", "--force-recreate")
}

func dockerComposeConfigServicesArgs(project string, runtime dockerComposeRuntime) []string {
	return append(dockerComposeBaseArgs(project, runtime), "config", "--services")
}

func dockerComposeConfiguredServices(ctx context.Context, project string, runtime dockerComposeRuntime) ([]string, error) {
	if available, reason := dockerComposeRedeployAvailability(runtime); !available {
		return nil, fmt.Errorf("%w: %s", ErrDockerRedeployUnavailable, reason)
	}
	return dockerTextLines(ctx, dockerComposeConfigServicesArgs(project, runtime)...)
}

func mergeDockerComposeServices(current []DockerComposeService, configured []string) []DockerComposeService {
	byName := make(map[string]DockerComposeService, len(current)+len(configured))
	for _, service := range current {
		if service.Name != "" {
			byName[service.Name] = service
		}
	}
	for _, name := range configured {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, exists := byName[name]; !exists {
			byName[name] = DockerComposeService{Name: name}
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	services := make([]DockerComposeService, 0, len(names))
	for _, name := range names {
		services = append(services, byName[name])
	}
	return services
}

func dockerComposeRuntimeFromInspections(project string, inspections []dockerContainerInspect) (dockerComposeRuntime, error) {
	fallbackReason := "O Docker não forneceu metadados suficientes para recriar este projeto Compose."
	for _, inspected := range inspections {
		labels := inspected.Config.Labels
		if strings.TrimSpace(labels["com.docker.compose.project"]) != project {
			continue
		}
		runtime := dockerComposeRuntimeFromLabels(labels)
		available, reason := dockerComposeRedeployAvailability(runtime)
		if available {
			return runtime, nil
		}
		if strings.TrimSpace(reason) != "" {
			fallbackReason = reason
		}
	}
	return dockerComposeRuntime{}, fmt.Errorf("%w: %s", ErrDockerRedeployUnavailable, fallbackReason)
}

func dockerContainerCondition(inspected dockerContainerInspect, fallback string) string {
	status := strings.ToLower(strings.TrimSpace(inspected.State.Status))
	if strings.TrimSpace(inspected.State.Error) != "" || inspected.State.OOMKilled || inspected.State.Dead || (status == "exited" && inspected.State.ExitCode != 0) {
		return "error"
	}
	if inspected.State.Restarting || status == "restarting" {
		return "restarting"
	}
	if inspected.State.Paused || status == "paused" {
		return "paused"
	}
	if inspected.State.Running || status == "running" {
		return "running"
	}
	if status == "created" {
		return "created"
	}
	fallback = strings.ToLower(strings.TrimSpace(fallback))
	switch fallback {
	case "running", "restarting", "paused", "created":
		return fallback
	case "dead":
		return "error"
	default:
		return "stopped"
	}
}

func (s *Service) DockerContainerLogs(ctx context.Context, sessionID, containerID string, tail int) (DockerLogs, error) {
	if err := s.requireDockerSession(sessionID); err != nil {
		return DockerLogs{}, err
	}
	if err := validateDockerIdentifier(containerID); err != nil {
		return DockerLogs{}, err
	}
	if tail < 20 {
		tail = 20
	}
	if tail > 1000 {
		tail = 1000
	}
	logsCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()
	command := exec.CommandContext(logsCtx, "docker", "container", "logs", "--tail", strconv.Itoa(tail), "--timestamps", containerID)
	output, err := command.CombinedOutput()
	if err != nil {
		return DockerLogs{}, dockerCommandError(logsCtx, err, output)
	}
	return DockerLogs{ContainerID: containerID, Tail: tail, Content: string(output)}, nil
}

func (s *Service) DockerContainerAction(ctx context.Context, sessionID, containerID, action string) error {
	if err := s.requireDockerSession(sessionID); err != nil {
		return err
	}
	if err := validateDockerIdentifier(containerID); err != nil {
		return err
	}
	if protectedDockerTarget(containerID) {
		return ErrDockerProtectedContainer
	}
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "start" && action != "stop" && action != "restart" {
		return fmt.Errorf("unsupported docker container action %q", action)
	}
	actionCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()
	output, err := exec.CommandContext(actionCtx, "docker", "container", action, containerID).CombinedOutput()
	if err != nil {
		return dockerCommandError(actionCtx, err, output)
	}
	return nil
}

func (s *Service) DockerComposeDown(ctx context.Context, sessionID, project string) error {
	if err := s.requireDockerSession(sessionID); err != nil {
		return err
	}
	project = strings.TrimSpace(project)
	if !dockerIdentifierPattern.MatchString(project) {
		return errors.New("invalid docker compose project identifier")
	}
	actionCtx, cancel := context.WithTimeout(ctx, dockerMutationTimeout)
	defer cancel()
	containerIDs, err := dockerTextLines(actionCtx, "container", "ls", "-a", "--no-trunc", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.ID}}")
	if err != nil {
		return err
	}
	for _, containerID := range containerIDs {
		if protectedDockerTarget(containerID) {
			return ErrDockerProtectedProject
		}
	}
	if len(containerIDs) > 0 {
		stopArgs := append([]string{"container", "stop", "--time", "10"}, containerIDs...)
		if output, runErr := exec.CommandContext(actionCtx, "docker", stopArgs...).CombinedOutput(); runErr != nil {
			return dockerCommandError(actionCtx, runErr, output)
		}
		removeArgs := append([]string{"container", "rm"}, containerIDs...)
		if output, runErr := exec.CommandContext(actionCtx, "docker", removeArgs...).CombinedOutput(); runErr != nil {
			return dockerCommandError(actionCtx, runErr, output)
		}
	}
	networkIDs, err := dockerTextLines(actionCtx, "network", "ls", "--no-trunc", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.ID}}")
	if err != nil {
		return err
	}
	if len(networkIDs) > 0 {
		removeArgs := append([]string{"network", "rm"}, networkIDs...)
		if output, runErr := exec.CommandContext(actionCtx, "docker", removeArgs...).CombinedOutput(); runErr != nil {
			return dockerCommandError(actionCtx, runErr, output)
		}
	}
	return nil
}

func (s *Service) DockerComposeRedeploy(ctx context.Context, sessionID, project string) error {
	if err := s.requireDockerSession(sessionID); err != nil {
		return err
	}
	project = strings.TrimSpace(project)
	if !dockerIdentifierPattern.MatchString(project) {
		return errors.New("invalid docker compose project identifier")
	}
	actionCtx, cancel := context.WithTimeout(ctx, dockerRedeployTimeout)
	defer cancel()
	containerIDs, err := dockerTextLines(actionCtx, "container", "ls", "-a", "--no-trunc", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.ID}}")
	if err != nil {
		return err
	}
	if len(containerIDs) == 0 {
		return fmt.Errorf("%w: projeto Compose não encontrado", ErrDockerRedeployUnavailable)
	}
	for _, containerID := range containerIDs {
		if protectedDockerTarget(containerID) {
			return ErrDockerProtectedProject
		}
	}
	args := append([]string{"container", "inspect"}, containerIDs...)
	inspections, err := dockerJSON[dockerContainerInspect](actionCtx, args...)
	if err != nil {
		return err
	}
	runtime, err := dockerComposeRuntimeFromInspections(project, inspections)
	if err != nil {
		return err
	}
	command := exec.CommandContext(actionCtx, "docker", dockerComposeRedeployArgs(project, runtime)...)
	command.Dir = runtime.WorkingDir
	output, err := command.CombinedOutput()
	if err != nil {
		return dockerCommandError(actionCtx, err, output)
	}
	return nil
}

func (s *Service) DockerResourceRemove(ctx context.Context, sessionID, kind, name string) error {
	if err := s.requireDockerSession(sessionID); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if !dockerIdentifierPattern.MatchString(name) {
		return errors.New("invalid docker resource identifier")
	}
	var args []string
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "volume", "volumes":
		args = []string{"volume", "rm", name}
	case "network", "networks":
		args = []string{"network", "rm", name}
	default:
		return errors.New("unsupported docker resource kind")
	}
	actionCtx, cancel := context.WithTimeout(ctx, dockerServicesTimeout)
	defer cancel()
	output, err := exec.CommandContext(actionCtx, "docker", args...).CombinedOutput()
	if err != nil {
		return dockerCommandError(actionCtx, err, output)
	}
	return nil
}

func (s *Service) requireDockerSession(sessionID string) error {
	if s.store == nil {
		return errors.New("session store is unavailable")
	}
	_, err := s.store.Get(strings.TrimSpace(sessionID))
	return err
}

func dockerJSONLines[T any](ctx context.Context, args ...string) ([]T, error) {
	command := exec.CommandContext(ctx, "docker", args...)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, dockerCommandError(ctx, err, exitErr.Stderr)
		}
		return nil, dockerCommandError(ctx, err, nil)
	}
	rows := make([]T, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row T
		if err := jsonUnmarshalDockerRow([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("decode docker output: %w", err)
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read docker output: %w", err)
	}
	return rows, nil
}

func dockerJSON[T any](ctx context.Context, args ...string) ([]T, error) {
	command := exec.CommandContext(ctx, "docker", args...)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, dockerCommandError(ctx, err, exitErr.Stderr)
		}
		return nil, dockerCommandError(ctx, err, nil)
	}
	rows := make([]T, 0)
	if len(strings.TrimSpace(string(output))) == 0 {
		return rows, nil
	}
	if err := json.Unmarshal(output, &rows); err != nil {
		return nil, fmt.Errorf("decode docker output: %w", err)
	}
	return rows, nil
}

func dockerTextLines(ctx context.Context, args ...string) ([]string, error) {
	command := exec.CommandContext(ctx, "docker", args...)
	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, dockerCommandError(ctx, err, exitErr.Stderr)
		}
		return nil, dockerCommandError(ctx, err, nil)
	}
	lines := make([]string, 0)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read docker output: %w", err)
	}
	return lines, nil
}

func jsonUnmarshalDockerRow(data []byte, target any) error {
	return json.Unmarshal(data, target)
}

func validateDockerIdentifier(value string) error {
	if !dockerIdentifierPattern.MatchString(strings.TrimSpace(value)) {
		return errors.New("invalid docker container identifier")
	}
	return nil
}

func protectedDockerTarget(value string) bool {
	hostname, err := os.Hostname()
	if err != nil {
		return false
	}
	hostname = strings.TrimSpace(hostname)
	value = strings.TrimSpace(value)
	return hostname != "" && value != "" && (strings.HasPrefix(hostname, value) || strings.HasPrefix(value, hostname))
}

func dockerCommandError(ctx context.Context, err error, output []byte) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("%w: command timed out", ErrDockerUnavailable)
	}
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%w: docker CLI not found", ErrDockerUnavailable)
	}
	message := strings.TrimSpace(string(output))
	if message == "" {
		message = strings.TrimSpace(err.Error())
	}
	lower := strings.ToLower(message)
	if strings.Contains(lower, "cannot connect to the docker daemon") || strings.Contains(lower, "is the docker daemon running") || strings.Contains(lower, "permission denied") {
		return fmt.Errorf("%w: %s", ErrDockerUnavailable, message)
	}
	if strings.Contains(lower, "is in use") || strings.Contains(lower, "active endpoints") {
		return fmt.Errorf("%w: %s", ErrDockerResourceInUse, message)
	}
	return errors.New(message)
}

func parseDockerBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(typed))
		return parsed
	default:
		return false
	}
}
