"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const optional = require("optional");
const bodyParser = require("body-parser");
const iterare_1 = require("iterare");
const logger_service_1 = require("@nestjs/common/services/logger.service");
const shared_utils_1 = require("@nestjs/common/utils/shared.utils");
const express_adapter_1 = require("./adapters/express-adapter");
const application_config_1 = require("./application-config");
const constants_1 = require("./constants");
const middlewares_module_1 = require("./middlewares/middlewares-module");
const routes_resolver_1 = require("./router/routes-resolver");
const microservices_package_not_found_exception_1 = require("./errors/exceptions/microservices-package-not-found.exception");
const container_1 = require("./middlewares/container");
const { SocketModule } = optional('@nestjs/websockets/socket-module') || {};
const { MicroservicesModule } = optional('@nestjs/microservices/microservices-module') || {};
const { NestMicroservice } = optional('@nestjs/microservices/nest-microservice') || {};
const { IoAdapter } = optional('@nestjs/websockets/adapters/io-adapter') || {};
class NestApplication {
    constructor(container, express) {
        this.container = container;
        this.express = express;
        this.logger = new logger_service_1.Logger(NestApplication.name, true);
        this.middlewaresModule = new middlewares_module_1.MiddlewaresModule();
        this.middlewaresContainer = new container_1.MiddlewaresContainer();
        this.microservicesModule = MicroservicesModule
            ? new MicroservicesModule()
            : null;
        this.socketModule = SocketModule
            ? new SocketModule()
            : null;
        this.httpServer = null;
        this.routesResolver = null;
        this.microservices = [];
        this.isInitialized = false;
        this.setupParserMiddlewares();
        this.httpServer = http.createServer(express);
        const ioAdapter = IoAdapter ? new IoAdapter(this.httpServer) : null;
        this.config = new application_config_1.ApplicationConfig(ioAdapter);
        this.routesResolver = new routes_resolver_1.RoutesResolver(container, express_adapter_1.ExpressAdapter, this.config);
    }
    setupParserMiddlewares() {
        this.express.use(bodyParser.json());
        this.express.use(bodyParser.urlencoded({ extended: true }));
    }
    setupModules() {
        return __awaiter(this, void 0, void 0, function* () {
            this.socketModule && this.socketModule.setup(this.container, this.config);
            if (this.microservicesModule) {
                this.microservicesModule.setup(this.container, this.config);
                this.microservicesModule.setupClients(this.container);
            }
            yield this.middlewaresModule.setup(this.middlewaresContainer, this.container, this.config);
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setupModules();
            yield this.setupRouter();
            this.callInitHook();
            this.logger.log(constants_1.messages.APPLICATION_READY);
            this.isInitialized = true;
        });
    }
    setupRouter() {
        return __awaiter(this, void 0, void 0, function* () {
            const router = express_adapter_1.ExpressAdapter.createRouter();
            yield this.setupMiddlewares(router);
            this.routesResolver.resolve(router);
            this.express.use(shared_utils_1.validatePath(this.config.getGlobalPrefix()), router);
        });
    }
    connectMicroservice(config) {
        if (!NestMicroservice) {
            throw new microservices_package_not_found_exception_1.MicroservicesPackageNotFoundException();
        }
        const instance = new NestMicroservice(this.container, config);
        instance.setupListeners();
        instance.setIsInitialized(true);
        instance.setIsInitHookCalled(true);
        this.microservices.push(instance);
        return instance;
    }
    getMicroservices() {
        return this.microservices;
    }
    startAllMicroservices(callback) {
        Promise.all(this.microservices.map(this.listenToPromise)).then(() => callback && callback());
    }
    startAllMicroservicesAsync() {
        return new Promise((resolve) => this.startAllMicroservices(resolve));
    }
    use(...args) {
        this.express.use(...args);
    }
    listen(port, ...args) {
        return __awaiter(this, void 0, void 0, function* () {
            (!this.isInitialized) && (yield this.init());
            this.httpServer.listen(port, ...args);
            return this.httpServer;
        });
    }
    listenAsync(port, hostname) {
        return new Promise((resolve) => {
            const server = this.listen(port, hostname, () => resolve(server));
        });
    }
    close() {
        this.socketModule && this.socketModule.close();
        this.httpServer && this.httpServer.close();
        this.microservices.forEach((microservice) => {
            microservice.setIsTerminated(true);
            microservice.close();
        });
        this.callDestroyHook();
    }
    setGlobalPrefix(prefix) {
        this.config.setGlobalPrefix(prefix);
    }
    useWebSocketAdapter(adapter) {
        this.config.setIoAdapter(adapter);
    }
    useGlobalFilters(...filters) {
        this.config.useGlobalFilters(...filters);
    }
    useGlobalPipes(...pipes) {
        this.config.useGlobalPipes(...pipes);
    }
    useGlobalInterceptors(...interceptors) {
        this.config.useGlobalInterceptors(...interceptors);
    }
    useGlobalGuards(...guards) {
        this.config.useGlobalGuards(...guards);
    }
    setupMiddlewares(instance) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.middlewaresModule.setupMiddlewares(this.middlewaresContainer, instance);
        });
    }
    listenToPromise(microservice) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            yield microservice.listen(resolve);
        }));
    }
    callInitHook() {
        const modules = this.container.getModules();
        modules.forEach((module) => {
            this.callModuleInitHook(module);
        });
    }
    callModuleInitHook(module) {
        const components = [...module.routes, ...module.components];
        iterare_1.default(components).map(([key, { instance }]) => instance)
            .filter((instance) => !shared_utils_1.isNil(instance))
            .filter(this.hasOnModuleInitHook)
            .forEach((instance) => instance.onModuleInit());
    }
    hasOnModuleInitHook(instance) {
        return !shared_utils_1.isUndefined(instance.onModuleInit);
    }
    callDestroyHook() {
        const modules = this.container.getModules();
        modules.forEach((module) => {
            this.callModuleDestroyHook(module);
        });
    }
    callModuleDestroyHook(module) {
        const components = [...module.routes, ...module.components];
        iterare_1.default(components).map(([key, { instance }]) => instance)
            .filter((instance) => !shared_utils_1.isNil(instance))
            .filter(this.hasOnModuleDestroyHook)
            .forEach((instance) => instance.onModuleDestroy());
    }
    hasOnModuleDestroyHook(instance) {
        return !shared_utils_1.isUndefined(instance.onModuleDestroy);
    }
}
exports.NestApplication = NestApplication;
